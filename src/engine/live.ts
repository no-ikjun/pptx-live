import type { ReactNode } from 'react'
import type { Deck, Slide, Step } from '../model'
import type { SlideOverrides } from './render'

export type LiveContext = {
  deck: Deck
  /** Original slide number (1-based, as in PowerPoint) of the slide on screen. */
  slide: number
}

export type LiveResult = {
  /** Overrides keyed by PowerPoint slide number. */
  slides?: Record<number, SlideOverrides | undefined>
  /** Contents of the side panel opened with the D key. */
  panel?: ReactNode
  /** Handle a key before the deck does; return true to stop the deck's handling. */
  onKey?: (e: KeyboardEvent, slide: number) => boolean
}

export type LiveOptions = {
  /**
   * Click animations by PowerPoint slide number, used instead of the PPT's own.
   * For builds the PPT doesn't have. Effects target shape ids (`shape.id`).
   */
  steps?: Record<number, (slide: Slide) => Step[]>
}

/**
 * A deck's live code: a React hook that runs on every render of the deck.
 * Use any hooks inside (data fetching, timers) and return overrides.
 */
export type LiveHook = ((ctx: LiveContext) => LiveResult) & { options?: LiveOptions }

export const defineLive = (hook: (ctx: LiveContext) => LiveResult, options?: LiveOptions): LiveHook =>
  Object.assign(hook, { options })

/** The deck with a live module's extra click steps in place. */
export function withLiveSteps(deck: Deck, live: LiveHook): Deck {
  const steps = live.options?.steps
  if (!steps) return deck
  return { ...deck, slides: deck.slides.map((s) => (steps[s.index] ? { ...s, steps: steps[s.index](s) } : s)) }
}
