/**
 * The deck format written by the converter and read by the renderer.
 * Coordinates are CSS pixels on a stage that is always 1920 px wide; the height
 * follows the PPTX aspect ratio (1080 for 16:9).
 */

export type Deck = {
  version: 1
  title: string
  width: number
  height: number
  /** Font families the deck asks for, in order of first use. */
  fonts: string[]
  /** Fonts known (from PANOSE codes) to be serif or monospaced, for picking fallbacks. */
  fontKinds?: Record<string, 'serif' | 'mono'>
  slides: Slide[]
  /** Things the converter could not reproduce exactly, for the import report. */
  warnings: string[]
}

export type Slide = {
  /** 1-based position in the original file (hidden slides keep their number). */
  index: number
  hidden: boolean
  background: Fill | null
  shapes: Shape[]
  notes: string
  steps: Step[]
  transition: { kind: 'fade' | 'none'; durMs: number }
}

// ---- paint -------------------------------------------------------------------

export type GradientStop = { pos: number; color: string }
export type Fill =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; kind: 'linear' | 'radial'; angle: number; stops: GradientStop[] }
  | { type: 'image'; src: string; tile: boolean; opacity?: number; crop?: Crop }

export type Crop = { l: number; t: number; r: number; b: number }

export type Stroke = {
  w: number
  color: string
  dash?: string
  head?: string
  tail?: string
  cap?: 'round' | 'square' | 'butt'
}

// ---- text --------------------------------------------------------------------

export type Spacing = { pct?: number; px?: number }

export type Run = {
  t: string
  size: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  color: string
  font?: string
  spacing?: number
  baseline?: number
  caps?: boolean
  highlight?: string
  link?: string
  br?: boolean
}

export type Para = {
  align: 'l' | 'ctr' | 'r' | 'just' | 'dist'
  lineSpacing: Spacing
  spaceBefore?: Spacing
  spaceAfter?: Spacing
  marL: number
  indent: number
  bullet?: { text: string; color: string; size: number; font?: string }
  runs: Run[]
}

export type TextBody = {
  insets: { l: number; t: number; r: number; b: number }
  anchor: 't' | 'ctr' | 'b'
  anchorCtr?: boolean
  wrap: boolean
  vertical?: boolean
  paras: Para[]
}

// ---- shapes ------------------------------------------------------------------

type Base = {
  /** Shape id from the PPTX (unique per slide); animation targets refer to it. */
  id: string
  name: string
  x: number
  y: number
  w: number
  h: number
  rot?: number
  flipH?: boolean
  flipV?: boolean
}

/** SVG path data in the shape's own pixel box (0..w, 0..h). */
export type PathGeom = { d: string; closed: boolean; fill: boolean; stroke: boolean }[]

export type ShapeNode = Base & {
  kind: 'shape'
  /** 'rect' and 'ellipse' render as CSS boxes; anything else carries paths. */
  geom: 'rect' | 'ellipse' | { radius: number } | { paths: PathGeom }
  fill?: Fill
  stroke?: Stroke
  text?: TextBody
  placeholder?: string
  link?: string
}

export type ImageNode = Base & {
  kind: 'image'
  src: string
  crop?: Crop
  opacity?: number
  stroke?: Stroke
  /** Clip the picture to a non-rectangular geometry. */
  clip?: 'ellipse' | { radius: number }
}

export type VideoNode = Base & { kind: 'video'; src: string; poster?: string }

export type Cell = {
  paras: Para[]
  pad: { l: number; r: number; t: number; b: number }
  anchor: 't' | 'ctr' | 'b'
  fill?: Fill
  borders: { top?: Stroke; bottom?: Stroke; left?: Stroke; right?: Stroke }
  colSpan?: number
  rowSpan?: number
  /** Covered by a neighbouring merged cell. */
  merged?: boolean
}

export type TableNode = Base & { kind: 'table'; cols: number[]; rows: { h: number; cells: Cell[] }[] }

export type ChartSeries = {
  name: string
  values: (number | null)[]
  xValues?: (number | null)[]
  color: string
  pointColors?: (string | null)[]
  line?: Stroke | null
  marker?: { symbol: string; size: number; fill: string; stroke?: string } | null
}

export type ChartAxis = {
  visible: boolean
  min?: number
  max?: number
  major?: number
  numFmt?: string
  gridColor?: string
  lineColor?: string
  labelColor: string
  labelSize: number
  reverse?: boolean
}

export type ChartNode = Base & {
  kind: 'chart'
  chart: {
    type: 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter'
    barDir: 'bar' | 'col'
    grouping: 'clustered' | 'stacked' | 'percentStacked' | 'standard'
    categories: string[]
    series: ChartSeries[]
    catAxis?: ChartAxis
    valAxis?: ChartAxis
    /** Inner plot area as fractions of the frame, when the chart sets it. */
    plotArea?: { x: number; y: number; w: number; h: number }
    dataLabels?: { numFmt?: string; size: number; color: string; bold: boolean; pos?: string }
    legend?: { pos: 'r' | 'l' | 't' | 'b'; size: number; color: string }
    title?: { text: string; size: number; color: string }
    gapWidth: number
    overlap: number
    holeSize: number
    font?: string
  }
}

export type GroupNode = Base & { kind: 'group'; children: Shape[] }

export type Shape = ShapeNode | ImageNode | VideoNode | TableNode | ChartNode | GroupNode

// ---- animation ---------------------------------------------------------------

export type Effect = {
  target: string
  cls: 'entr' | 'exit' | 'emph'
  kind: 'appear' | 'fade' | 'wipe' | 'fly' | 'zoom'
  dir?: 'l' | 'r' | 'u' | 'd'
  /** Start offset from the beginning of its step, in ms. */
  delay: number
  dur: number
}

/** One click (or one automatic continuation) of the slide's build sequence. */
export type Step = { auto: boolean; effects: Effect[] }
