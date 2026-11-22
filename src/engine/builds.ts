import type { CSSProperties } from 'react'
import type { Effect, Step } from '../model'
import type { AnimState } from './render'

/**
 * Where a slide's build sequence stands: when the slide appeared and when each
 * click step was triggered. `done` shows the final state (used when stepping
 * back into a slide).
 */
export type BuildClock = { slideStart: number; clicks: (number | undefined)[]; done: boolean }

export const freshClock = (now: number): BuildClock => ({ slideStart: now, clicks: [], done: false })
export const doneClock = (): BuildClock => ({ slideStart: 0, clicks: [], done: true })

const stepDur = (s: Step) => Math.max(0, ...s.effects.map((e) => e.delay + e.dur))

export function stepStarts(steps: Step[], clock: BuildClock): (number | undefined)[] {
  const out: (number | undefined)[] = []
  steps.forEach((s, i) => {
    if (clock.done) out.push(-Infinity)
    else if (s.auto) {
      const prev = i === 0 ? clock.slideStart : out[i - 1]
      out.push(prev === undefined ? undefined : i === 0 ? prev : prev + stepDur(steps[i - 1]))
    } else out.push(clock.clicks[i])
  })
  return out
}

/** Index of the next step that waits for a click, or null when none is left. */
export function nextClickStep(steps: Step[], clock: BuildClock): number | null {
  if (clock.done) return null
  const starts = stepStarts(steps, clock)
  const i = starts.findIndex((s, k) => s === undefined && !steps[k].auto)
  return i < 0 ? null : i
}

const ease = (t: number) => 1 - Math.pow(1 - t, 3)

function partial(e: Effect, p: number): CSSProperties {
  // p: 0 → fully hidden, 1 → fully shown.
  const q = (1 - p) * 100
  switch (e.kind) {
    case 'fade':
      return { opacity: p }
    case 'zoom':
      return { opacity: p, transform: `scale(${0.3 + 0.7 * p})` }
    case 'fly': {
      const d = (1 - p) * 1200
      const t = e.dir === 'd' ? `translateY(${d}px)` : e.dir === 'u' ? `translateY(${-d}px)` : e.dir === 'l' ? `translateX(${-d}px)` : `translateX(${d}px)`
      return { transform: t }
    }
    case 'wipe': {
      const clip = e.dir === 'd' ? `inset(0 0 ${q}% 0)` : e.dir === 'u' ? `inset(${q}% 0 0 0)` : e.dir === 'l' ? `inset(0 0 0 ${q}%)` : `inset(0 ${q}% 0 0)`
      return { clipPath: clip }
    }
    default:
      return {}
  }
}

/** Visual state of every animated shape at time `now`, plus whether anything is still moving. */
export function animState(steps: Step[], clock: BuildClock, now: number): { anim: AnimState; active: boolean } {
  const anim: AnimState = new Map()
  const starts = stepStarts(steps, clock)
  const all = steps.flatMap((s, i) => s.effects.map((e) => ({ e, at: starts[i] === undefined ? undefined : starts[i]! + e.delay })))
  // Shapes whose first effect is an entrance start out hidden.
  const seen = new Set<string>()
  for (const { e } of all) {
    if (seen.has(e.target)) continue
    seen.add(e.target)
    if (e.cls === 'entr') anim.set(e.target, 'hidden')
  }
  let active = false
  const ordered = all.filter((x) => x.at !== undefined).sort((a, b) => a.at! - b.at!)
  for (const { e, at } of ordered) {
    if (now < at!) {
      active = true
      continue
    }
    const raw = e.dur ? (now - at!) / e.dur : 1
    if (raw >= 1) {
      if (e.cls === 'entr') anim.delete(e.target)
      else anim.set(e.target, 'hidden')
      continue
    }
    active = true
    const p = ease(Math.max(0, raw))
    anim.set(e.target, partial(e, e.cls === 'entr' ? p : 1 - p))
  }
  // A pending automatic step keeps the clock running too.
  if (starts.some((s, i) => s !== undefined && s > now && steps[i])) active = true
  return { anim, active }
}
