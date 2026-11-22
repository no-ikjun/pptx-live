import type { Effect, Step } from '../model'
import { attr, child, find, findAll, kids, num, type El } from './xml'

/**
 * Reads the slide's main animation sequence into click steps.
 * Entrance and exit effects are kept (appear, fade, wipe, fly, zoom; others
 * become a fade). Emphasis effects and interactive triggers are not played.
 */
export function readAnimations(slide: El, warn: (m: string) => void): Step[] {
  const timing = child(slide, 'p:timing')
  if (!timing) return []
  const ctns = findAll(timing, 'p:cTn')
  const main = ctns.find((c) => attr(c, 'nodeType') === 'mainSeq')
  if (ctns.some((c) => attr(c, 'nodeType') === 'interactiveSeq')) warn('Click-triggered (interactive) animations are not played')
  if (!main) return []

  const steps: Step[] = []
  for (const group of kids(child(main, 'p:childTnLst'), 'p:par')) {
    const effects: Effect[] = []
    let firstNode: string | null = null
    for (const container of kids(child(child(group, 'p:cTn'), 'p:childTnLst'), 'p:par')) {
      const cCtn = child(container, 'p:cTn')
      const offset = delayOf(cCtn)
      for (const par of kids(child(cCtn, 'p:childTnLst'), 'p:par')) {
        const e = child(par, 'p:cTn')
        if (!e) continue
        const cls = attr(e, 'presetClass')
        firstNode ??= attr(e, 'nodeType')
        if (cls !== 'entr' && cls !== 'exit') {
          if (cls === 'emph') warn('Emphasis animations are not played')
          continue
        }
        const tgt = find(e, 'p:spTgt')
        const target = attr(tgt, 'spid')
        if (!target) continue
        if (find(tgt, 'p:txEl')) warn('Paragraph-by-paragraph builds play as whole-shape builds')
        const { kind, dir } = effectKind(e, num(e, 'presetID', 1), num(e, 'presetSubtype', 0))
        effects.push({ target, cls, kind, dir, delay: offset + delayOf(e), dur: kind === 'appear' ? 0 : durationOf(e) })
      }
    }
    if (!effects.length) continue
    const clickCond = findAll(child(group, 'p:cTn'), 'p:cond').some((c) => attr(c, 'delay') === 'indefinite')
    const auto = firstNode !== 'clickEffect' && !(firstNode === null && clickCond)
    steps.push({ auto, effects })
  }
  return steps
}

function delayOf(ctn: El | null): number {
  const d = attr(find(child(ctn, 'p:stCondLst'), 'p:cond'), 'delay')
  return d && d !== 'indefinite' ? Number(d) : 0
}

function durationOf(effect: El): number {
  let max = 0
  for (const beh of findAll(effect, 'p:cBhvr')) {
    const ctn = child(beh, 'p:cTn')
    const dur = attr(ctn, 'dur')
    if (!dur || dur === 'indefinite') continue
    max = Math.max(max, delayOf(ctn) + Number(dur))
  }
  return max
}

const FLY_DIR: Record<number, Effect['dir']> = { 1: 'u', 2: 'r', 4: 'd', 8: 'l' }

function effectKind(e: El, preset: number, subtype: number): { kind: Effect['kind']; dir?: Effect['dir'] } {
  const filter = attr(find(e, 'p:animEffect'), 'filter') ?? ''
  const wipe = filter.match(/^wipe\((\w+)\)/)
  if (wipe) {
    // For an entrance, "wipe(down)" reveals from the top edge downward.
    const dir = { down: 'd', up: 'u', left: 'l', right: 'r' }[wipe[1]] as Effect['dir']
    return { kind: 'wipe', dir }
  }
  if (preset === 1) return { kind: 'appear' }
  if (preset === 2 || preset === 42 || preset === 47) {
    // Fly in "from bottom" moves upward into place.
    const from = FLY_DIR[subtype] ?? (preset === 47 ? 'u' : 'd')
    return { kind: 'fly', dir: from }
  }
  if (preset === 53 || preset === 23 || preset === 21 || preset === 31) return { kind: 'zoom' }
  return { kind: 'fade' }
}

