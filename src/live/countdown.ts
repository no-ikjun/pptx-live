import { useCallback, useEffect, useState } from 'react'

export type Countdown = { durationMs: number; startedAt: number | null; elapsedMs: number; touched: boolean }

export function remaining(t: Countdown, now: number) {
  return Math.max(0, t.durationMs - t.elapsedMs - (t.startedAt !== null ? now - t.startedAt : 0))
}

/** "13:00"; seconds round up so the display reaches 00:00 exactly at the end. */
export function formatClock(ms: number) {
  const total = Math.ceil(ms / 1000)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/**
 * Countdown timers tied to slides. A timer starts by itself the first time its
 * slide appears; toggle() pauses or resumes, reset() returns to full time and waits.
 */
export function useCountdowns(durations: Record<number, number>, slide: number) {
  const [timers, setTimers] = useState<Record<number, Countdown>>(() =>
    Object.fromEntries(Object.entries(durations).map(([n, d]) => [n, { durationMs: d, startedAt: null, elapsedMs: 0, touched: false }])),
  )
  useEffect(() => {
    if (!(slide in durations)) return
    setTimers((t) => (t[slide].touched ? t : { ...t, [slide]: { ...t[slide], startedAt: Date.now(), touched: true } }))
  }, [slide, durations])

  const running = Object.values(timers).some((t) => t.startedAt !== null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    let id = 0
    const tick = () => {
      setNow(Date.now())
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [running])

  const toggle = useCallback((n: number) => {
    setTimers((t) => {
      const c = t[n]
      if (!c) return t
      const at = Date.now()
      if (c.startedAt !== null) return { ...t, [n]: { ...c, startedAt: null, elapsedMs: c.elapsedMs + at - c.startedAt } }
      if (remaining(c, at) === 0) return t
      return { ...t, [n]: { ...c, startedAt: at, touched: true } }
    })
  }, [])
  const reset = useCallback((n: number) => setTimers((t) => (t[n] ? { ...t, [n]: { ...t[n], startedAt: null, elapsedMs: 0, touched: true } } : t)), [])

  return { timers, now: running ? now : Date.now(), toggle, reset }
}
