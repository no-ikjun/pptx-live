import type { ReactNode } from 'react'
import type { Deck } from '../model'
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

/**
 * A deck's live code: a React hook that runs on every render of the deck.
 * Use any hooks inside (data fetching, timers) and return overrides.
 */
export type LiveHook = (ctx: LiveContext) => LiveResult

export const defineLive = (hook: LiveHook): LiveHook => hook
