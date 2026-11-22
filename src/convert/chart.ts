import type { ChartAxis, ChartNode, ChartSeries, Stroke } from '../model'
import { readColor, type Scheme } from './color'
import type { Package } from './package'
import { attr, child, children, find, findAll, kids, num, text, type El } from './xml'

type Chart = ChartNode['chart']

const TYPES: Record<string, Chart['type']> = {
  barChart: 'bar', bar3DChart: 'bar', lineChart: 'line', line3DChart: 'line', areaChart: 'area', area3DChart: 'area',
  pieChart: 'pie', pie3DChart: 'pie', ofPieChart: 'pie', doughnutChart: 'doughnut', scatterChart: 'scatter', bubbleChart: 'scatter',
}

/** Reads a chart part into a renderable spec, using cached values stored in the PPTX. */
export function readChart(pkg: Package, path: string, scheme: Scheme, pt: number, warn: (m: string) => void): Chart | null {
  const root = pkg.xml(path)
  const chart = child(root, 'c:chart')
  const plot = child(chart, 'c:plotArea')
  if (!plot) return null
  const groups = children(plot).filter((c) => TYPES[c.localName])
  if (!groups.length) {
    warn('A chart type is not supported and was skipped')
    return null
  }
  if (groups.length > 1) warn('Combination charts show only their first chart type')
  const g = groups[0]
  const type = TYPES[g.localName]

  const baseTx = textProps(child(root, 'c:txPr'), scheme, pt, { size: 10 * pt, color: '#595959' })
  const accents = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'].map((k) => scheme[k] ?? '#4472C4')
  const vary = attr(child(g, 'c:varyColors'), 'val') === '1' && (type === 'pie' || type === 'doughnut')

  const series: ChartSeries[] = kids(g, 'c:ser').map((ser, i) => {
    const idx = num(child(ser, 'c:idx'), 'val', i)
    const spPr = child(ser, 'c:spPr')
    const fillColor = readColor(child(spPr, 'a:solidFill'), scheme)
    const ln = child(spPr, 'a:ln')
    const lnColor = readColor(child(ln, 'a:solidFill'), scheme)
    const color = (type === 'line' || type === 'scatter' ? lnColor ?? fillColor : fillColor ?? lnColor) ?? accents[idx % 6]
    const values = numbers(child(ser, 'c:val') ?? child(ser, 'c:yVal'))
    const s: ChartSeries = { name: seriesName(ser), values, color }
    const xVal = child(ser, 'c:xVal')
    if (xVal) s.xValues = numbers(xVal)
    const points = kids(ser, 'c:dPt')
    if (points.length || vary) {
      s.pointColors = values.map((_, p) => (vary ? accents[p % 6] : null))
      for (const dp of points) {
        const p = num(child(dp, 'c:idx'), 'val', 0)
        const c = readColor(child(child(dp, 'c:spPr'), 'a:solidFill'), scheme)
        if (c) s.pointColors[p] = c
      }
    }
    if (type === 'line' || type === 'scatter') {
      s.line = ln && child(ln, 'a:noFill') ? null : ({ w: ((num(ln, 'w', 28575) / 12700) * pt), color: lnColor ?? color } satisfies Stroke)
      const marker = child(ser, 'c:marker')
      const symbol = attr(child(marker, 'c:symbol'), 'val') ?? (type === 'scatter' ? 'circle' : 'none')
      if (symbol !== 'none') {
        const mSp = child(marker, 'c:spPr')
        s.marker = {
          symbol,
          size: num(child(marker, 'c:size'), 'val', 5) * pt,
          fill: readColor(child(mSp, 'a:solidFill'), scheme) ?? color,
          stroke: readColor(child(child(mSp, 'a:ln'), 'a:solidFill'), scheme) ?? undefined,
        }
      } else s.marker = null
    }
    return s
  })

  const categories = (() => {
    const ser = kids(g, 'c:ser')[0]
    const cat = child(ser, 'c:cat')
    if (!cat) return series[0]?.values.map((_, i) => String(i + 1)) ?? []
    return strings(cat)
  })()

  const axes = children(plot).filter((c) => ['catAx', 'valAx', 'dateAx', 'serAx'].includes(c.localName))
  const axisOf = (el: El | undefined): ChartAxis | undefined => {
    if (!el) return undefined
    const scaling = child(el, 'c:scaling')
    const grid = child(el, 'c:majorGridlines')
    const tx = textProps(child(el, 'c:txPr'), scheme, pt, baseTx)
    const lineEl = child(child(el, 'c:spPr'), 'a:ln')
    const a: ChartAxis = {
      visible: attr(child(el, 'c:delete'), 'val') !== '1' && attr(child(el, 'c:tickLblPos'), 'val') !== 'none',
      labelColor: tx.color,
      labelSize: tx.size,
      reverse: attr(child(scaling, 'c:orientation'), 'val') === 'maxMin',
    }
    const min = num(child(scaling, 'c:min'), 'val')
    const max = num(child(scaling, 'c:max'), 'val')
    const major = num(child(el, 'c:majorUnit'), 'val')
    if (min !== null) a.min = min
    if (max !== null) a.max = max
    if (major !== null) a.major = major
    const fmt = attr(child(el, 'c:numFmt'), 'formatCode')
    if (fmt && fmt !== 'General') a.numFmt = fmt
    if (grid) a.gridColor = readColor(find(grid, 'a:solidFill'), scheme) ?? '#D9D9D9'
    if (lineEl && !child(lineEl, 'a:noFill')) a.lineColor = readColor(child(lineEl, 'a:solidFill'), scheme) ?? '#D9D9D9'
    return a
  }
  const valAxes = axes.filter((a) => a.localName === 'valAx')
  const catAxis = type === 'scatter' ? valAxes.find((a) => attr(child(a, 'c:axPos'), 'val') === 'b' || attr(child(a, 'c:axPos'), 'val') === 't') : axes.find((a) => a.localName === 'catAx' || a.localName === 'dateAx')
  const valAxis = type === 'scatter' ? valAxes.find((a) => a !== catAxis) : valAxes[0]

  const out: Chart = {
    type,
    barDir: (attr(child(g, 'c:barDir'), 'val') as Chart['barDir']) ?? 'col',
    grouping: (attr(child(g, 'c:grouping'), 'val') as Chart['grouping']) ?? 'clustered',
    categories,
    series,
    catAxis: type === 'pie' || type === 'doughnut' ? undefined : axisOf(catAxis),
    valAxis: type === 'pie' || type === 'doughnut' ? undefined : axisOf(valAxis),
    gapWidth: num(child(g, 'c:gapWidth'), 'val', 150),
    overlap: num(child(g, 'c:overlap'), 'val', 0),
    holeSize: num(child(g, 'c:holeSize'), 'val', 50),
    font: baseTx.font,
  }

  const manual = find(child(plot, 'c:layout'), 'c:manualLayout')
  if (manual && attr(child(manual, 'c:layoutTarget'), 'val') !== 'outer') {
    out.plotArea = {
      x: num(child(manual, 'c:x'), 'val', 0),
      y: num(child(manual, 'c:y'), 'val', 0),
      w: num(child(manual, 'c:w'), 'val', 1),
      h: num(child(manual, 'c:h'), 'val', 1),
    }
  }

  // Data labels: series-level settings win over the chart group's.
  const dl = findAll(g, 'c:dLbls').find((d) => attr(child(d, 'c:showVal'), 'val') === '1' || attr(child(d, 'c:showPercent'), 'val') === '1')
  if (dl) {
    const tx = textProps(child(dl, 'c:txPr'), scheme, pt, baseTx)
    out.dataLabels = {
      numFmt: attr(child(dl, 'c:numFmt'), 'formatCode') ?? undefined,
      size: tx.size,
      color: tx.color,
      bold: tx.bold,
      pos: attr(child(dl, 'c:dLblPos'), 'val') ?? undefined,
    }
  }
  const legend = child(chart, 'c:legend')
  if (legend) {
    const tx = textProps(child(legend, 'c:txPr'), scheme, pt, baseTx)
    out.legend = { pos: (attr(child(legend, 'c:legendPos'), 'val') as 'r') ?? 'r', size: tx.size, color: tx.color }
  }
  const title = child(chart, 'c:title')
  if (title && attr(child(chart, 'c:autoTitleDeleted'), 'val') !== '1') {
    const t = findAll(title, 'a:t').map(text).join('') || (series.length === 1 ? series[0].name : '')
    const tx = textProps(find(title, 'a:p') ? find(title, 'a:pPr') : null, scheme, pt, { ...baseTx, size: baseTx.size * 1.4 })
    if (t) out.title = { text: t, size: tx.size, color: tx.color }
  }
  return out
}

function textProps(el: El | null, scheme: Scheme, pt: number, base: { size: number; color: string; bold?: boolean; font?: string }) {
  const def = el ? find(el, 'a:defRPr') : null
  const sz = num(def, 'sz')
  return {
    size: sz !== null ? (sz / 100) * pt : base.size,
    color: readColor(child(def, 'a:solidFill'), scheme) ?? base.color,
    bold: attr(def, 'b') === '1' || (attr(def, 'b') === null && !!base.bold),
    font: attr(child(def, 'a:latin'), 'typeface') ?? base.font,
  }
}

function seriesName(ser: El) {
  const tx = child(ser, 'c:tx')
  if (!tx) return ''
  return text(find(tx, 'c:v'))
}

function cache(el: El | null) {
  return find(el, 'c:strCache') ?? find(el, 'c:numCache') ?? find(el, 'c:strLit') ?? find(el, 'c:numLit') ?? find(el, 'c:multiLvlStrCache')
}

function strings(el: El | null): string[] {
  const c = cache(el)
  const count = num(child(c, 'c:ptCount'), 'val', 0)
  const out = Array<string>(count).fill('')
  for (const pt of findAll(c, 'c:pt')) {
    const i = num(pt, 'idx', 0)
    if (i < count && !out[i]) out[i] = text(child(pt, 'c:v'))
  }
  return out
}

function numbers(el: El | null): (number | null)[] {
  return strings(el).map((s) => (s === '' || Number.isNaN(Number(s)) ? null : Number(s)))
}
