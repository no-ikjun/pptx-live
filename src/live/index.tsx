/** Everything a deck's live.tsx usually needs. */
export { defineLive, type LiveContext, type LiveResult } from '../engine/live'
export { RunSpan, BoxView, type BoxOverride, type CellOverride, type SlideOverrides } from '../engine/render'
export { formatNumber } from '../engine/Chart'
export { useCsvSource, sheetCsvUrl, sheetIdFrom, type CsvSource } from './source'
export { SourcePanel } from './SourcePanel'
export { useCountdowns, formatClock, remaining, type Countdown } from './countdown'
export type { Para, Run, Shape, ShapeNode, TableNode, ChartNode, Deck } from '../model'

import type { ReactNode } from 'react'
import { RunSpan } from '../engine/render'
import type { Para, Run } from '../model'

/** Replaces a paragraph's text while keeping the look of its first run. */
export function textLike(p: Para, text: string, patch: Partial<Run> = {}): ReactNode {
  return <RunSpan r={{ ...p.runs[0], ...patch, t: text }} />
}
