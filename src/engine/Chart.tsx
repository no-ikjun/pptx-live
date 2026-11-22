import type { ChartAxis, ChartNode, ChartSeries } from '../model'
import { fontStack } from './fonts'

type Spec = ChartNode['chart']

/** Formats a number with a small subset of Excel number formats ('0', '0.0', '#,##0', '0%', '"literal"'). */
export function formatNumber(v: number, fmt?: string): string {
  if (!fmt || fmt === 'General') return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100)
  const section = fmt.split(';')[v < 0 && fmt.includes(';') ? 1 : 0]
  const percent = /%/.test(section.replace(/"[^"]*"/g, ''))
  const core = section.replace(/"[^"]*"|\\./g, '').match(/[#0,.]+/)?.[0] ?? '0'
  const decimals = core.includes('.') ? core.split('.')[1].replace(/[^0#]/g, '').length : 0
  const grouping = core.includes(',')
  const n = (percent ? v * 100 : v) * (v < 0 && fmt.includes(';') ? -1 : 1)
  let s = n.toFixed(decimals)
  if (grouping) s = Number(s).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  let out = ''
  let used = false
  for (const m of section.matchAll(/"([^"]*)"|\\(.)|([#0,.]+)|(%)|([^"\\#0,.%]+)/g)) {
    if (m[1] !== undefined) out += m[1]
    else if (m[2] !== undefined) out += m[2]
    else if (m[3] !== undefined) {
      if (!used) out += s
      used = true
    } else if (m[4]) out += '%'
    else if (m[5] && !/[_*?]/.test(m[5])) out += m[5]
  }
  return out || s
}

function niceScale(lo: number, hi: number, axis?: ChartAxis) {
  let min = axis?.min ?? Math.min(0, lo)
  let max = axis?.max ?? hi
  if (max === min) max = min + 1
  let step = axis?.major
  if (!step) {
    const raw = (max - min) / 5
    const mag = Math.pow(10, Math.floor(Math.log10(raw)))
    const n = raw / mag
    step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag
  }
  if (axis?.min === undefined) min = Math.floor(min / step) * step
  if (axis?.max === undefined) max = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let t = min; t <= max + step * 1e-6; t += step) ticks.push(Math.round(t * 1e6) / 1e6)
  return { min, max, ticks }
}

function MarkerShape({ m, x, y, color }: { m: NonNullable<ChartSeries['marker']>; x: number; y: number; color: string }) {
  const r = m.size / 2
  const fill = m.fill ?? color
  const stroke = m.stroke
  switch (m.symbol) {
    case 'square':
      return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} fill={fill} stroke={stroke} />
    case 'diamond':
      return <path d={`M${x},${y - r} L${x + r},${y} L${x},${y + r} L${x - r},${y} Z`} fill={fill} stroke={stroke} />
    case 'triangle':
      return <path d={`M${x},${y - r} L${x + r},${y + r} L${x - r},${y + r} Z`} fill={fill} stroke={stroke} />
    case 'x':
    case 'star':
    case 'plus':
      return <path d={`M${x - r},${y - r} L${x + r},${y + r} M${x + r},${y - r} L${x - r},${y + r}`} stroke={fill} strokeWidth={2} />
    default:
      return <circle cx={x} cy={y} r={r} fill={fill} stroke={stroke} strokeWidth={stroke ? 1.5 : 0} />
  }
}

export function ChartView({ spec, w, h }: { spec: Spec; w: number; h: number }) {
  const font = fontStack(spec.font, false).family
  const labelSize = spec.valAxis?.labelSize ?? spec.catAxis?.labelSize ?? 20
  const legendItems = spec.legend
    ? spec.type === 'pie' || spec.type === 'doughnut'
      ? spec.categories.map((c, i) => ({ name: c, color: spec.series[0]?.pointColors?.[i] ?? spec.series[0]?.color ?? '#999' }))
      : spec.series.map((s) => ({ name: s.name, color: s.color }))
    : []

  // Plot rectangle: the chart's manual layout when given, else room for labels.
  const titleH = spec.title ? spec.title.size * 1.8 : 0
  const legendW = spec.legend?.pos === 'r' ? Math.min(w * 0.3, Math.max(...legendItems.map((l) => l.name.length), 4) * (spec.legend.size * 0.7) + 40) : 0
  const legendH = spec.legend && (spec.legend.pos === 'b' || spec.legend.pos === 't') ? spec.legend.size * 2.2 : 0
  const plot = spec.plotArea
    ? { x: spec.plotArea.x * w, y: spec.plotArea.y * h, w: spec.plotArea.w * w, h: spec.plotArea.h * h }
    : (() => {
        const left = spec.type === 'pie' || spec.type === 'doughnut' ? 8 : labelSize * (spec.barDir === 'bar' && spec.type === 'bar' ? 5 : 3.2)
        const bottom = spec.type === 'pie' || spec.type === 'doughnut' ? 8 : labelSize * 2
        const top = titleH + (spec.legend?.pos === 't' ? legendH : 0) + 8
        return { x: left, y: top, w: w - left - legendW - 12, h: h - top - bottom - (spec.legend?.pos === 'b' ? legendH : 0) }
      })()

  return (
    <svg width={w} height={h} style={{ position: 'absolute', inset: 0, overflow: 'visible', fontFamily: font }}>
      {spec.title && (
        <text x={w / 2} y={spec.title.size * 1.2} textAnchor="middle" fontSize={spec.title.size} fill={spec.title.color}>
          {spec.title.text}
        </text>
      )}
      {spec.type === 'pie' || spec.type === 'doughnut' ? <Pie spec={spec} plot={plot} /> : spec.type === 'scatter' ? <Scatter spec={spec} plot={plot} /> : <Cartesian spec={spec} plot={plot} />}
      {spec.legend && (
        <g fontSize={spec.legend.size} fill={spec.legend.color}>
          {legendItems.map((l, i) => {
            const vertical = spec.legend!.pos === 'r' || spec.legend!.pos === 'l'
            const x = vertical ? (spec.legend!.pos === 'r' ? w - legendW + 8 : 8) : w / 2 - (legendItems.length * 120) / 2 + i * 120
            const y = vertical ? plot.y + plot.h / 2 - (legendItems.length * spec.legend!.size * 1.6) / 2 + i * spec.legend!.size * 1.6 : spec.legend!.pos === 't' ? titleH + spec.legend!.size : h - spec.legend!.size * 0.8
            return (
              <g key={i}>
                <rect x={x} y={y - spec.legend!.size * 0.7} width={spec.legend!.size * 0.7} height={spec.legend!.size * 0.7} fill={l.color} />
                <text x={x + spec.legend!.size} y={y}>
                  {l.name}
                </text>
              </g>
            )
          })}
        </g>
      )}
    </svg>
  )
}

type Plot = { x: number; y: number; w: number; h: number }

function Cartesian({ spec, plot }: { spec: Spec; plot: Plot }) {
  const horizontal = spec.type === 'bar' && spec.barDir === 'bar'
  const stacked = spec.grouping === 'stacked' || spec.grouping === 'percentStacked'
  const percent = spec.grouping === 'percentStacked'
  const n = spec.categories.length || Math.max(...spec.series.map((s) => s.values.length), 0)
  const totals = Array.from({ length: n }, (_, i) => spec.series.reduce((a, s) => a + Math.abs(s.values[i] ?? 0), 0))
  const value = (s: ChartSeries, i: number) => (percent ? ((s.values[i] ?? 0) / (totals[i] || 1)) * 1 : (s.values[i] ?? 0))
  const extent = stacked
    ? Array.from({ length: n }, (_, i) => spec.series.reduce((a, s) => a + Math.max(0, value(s, i)), 0))
    : spec.series.flatMap((s) => s.values.filter((v): v is number => v !== null))
  const lo = Math.min(0, ...(stacked ? [0] : extent))
  const hi = Math.max(...extent, 0)
  const scale = niceScale(lo, hi, spec.valAxis)
  const va = spec.valAxis
  const ca = spec.catAxis
  const valLen = horizontal ? plot.w : plot.h
  const catLen = horizontal ? plot.h : plot.w
  const pos = (v: number) => ((v - scale.min) / (scale.max - scale.min)) * valLen
  const band = catLen / Math.max(n, 1)
  // Bar charts list the first category at the bottom (horizontal) unless reversed.
  const catIndex = (i: number) => (horizontal !== !!ca?.reverse ? n - 1 - i : i)
  const valuePt = (vPos: number, cPos: number): [number, number] => (horizontal ? [plot.x + vPos, plot.y + cPos] : [plot.x + cPos, plot.y + plot.h - vPos])

  const out: React.ReactNode[] = []
  // Grid and value labels.
  scale.ticks.forEach((t, k) => {
    const p = pos(t)
    const [x1, y1] = valuePt(p, 0)
    const [x2, y2] = valuePt(p, catLen)
    if (va?.gridColor) out.push(<line key={`g${k}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={va.gridColor} strokeWidth={1} />)
    if (va?.visible !== false)
      out.push(
        <text key={`v${k}`} x={horizontal ? x1 : plot.x - 8} y={horizontal ? plot.y + plot.h + (va?.labelSize ?? 20) * 1.2 : y1} textAnchor={horizontal ? 'middle' : 'end'} dominantBaseline={horizontal ? 'auto' : 'central'} fontSize={va?.labelSize} fill={va?.labelColor}>
          {formatNumber(percent ? t * 100 : t, va?.numFmt ?? (percent ? '0"%"' : undefined))}
        </text>,
      )
  })
  // Category labels and axis line.
  for (let i = 0; i < n; i++) {
    const c = (catIndex(i) + 0.5) * band
    if (ca?.visible !== false) {
      const [x, y] = valuePt(0, c)
      out.push(
        <text key={`c${i}`} x={horizontal ? plot.x - 10 : x} y={horizontal ? y : plot.y + plot.h + (ca?.labelSize ?? 20) * 1.2} textAnchor={horizontal ? 'end' : 'middle'} dominantBaseline={horizontal ? 'central' : 'auto'} fontSize={ca?.labelSize} fill={ca?.labelColor}>
          {spec.categories[i]}
        </text>,
      )
    }
  }
  if (ca?.lineColor || ca?.visible) {
    const [x1, y1] = valuePt(pos(0), 0)
    const [x2, y2] = valuePt(pos(0), catLen)
    out.push(<line key="axis" x1={x1} y1={y1} x2={x2} y2={y2} stroke={ca?.lineColor ?? '#BFBFBF'} strokeWidth={1.5} />)
  }

  const dl = spec.dataLabels
  if (spec.type === 'bar') {
    const groupW = band / (1 + spec.gapWidth / 100)
    const k = stacked ? 1 : spec.series.length
    const overlap = stacked ? 1 : spec.overlap / 100
    const barW = groupW / (k - (k - 1) * Math.max(0, overlap))
    const base = Array<number>(n).fill(0)
    spec.series.forEach((s, si) => {
      for (let i = 0; i < n; i++) {
        const v = s.values[i]
        if (v === null || v === undefined) continue
        const val = value(s, i)
        const from = stacked ? base[i] : 0
        const to = from + val
        if (stacked) base[i] = to
        const c0 = catIndex(i) * band + (band - groupW) / 2 + (stacked ? 0 : si * barW * (1 - Math.max(0, overlap)))
        const a = pos(Math.min(from, to))
        const b = pos(Math.max(from, to))
        const color = s.pointColors?.[i] ?? s.color
        const rect = horizontal ? { x: plot.x + a, y: plot.y + c0, width: b - a, height: barW } : { x: plot.x + c0, y: plot.y + plot.h - b, width: barW, height: b - a }
        out.push(<rect key={`b${si}-${i}`} {...rect} fill={color} />)
        if (dl) {
          const label = formatNumber(v, dl.numFmt)
          const inside = stacked || dl.pos === 'ctr' || dl.pos === 'inEnd'
          const tx = horizontal ? (inside ? rect.x + rect.width / 2 : rect.x + rect.width + 8) : rect.x + rect.width / 2
          const ty = horizontal ? rect.y + rect.height / 2 : inside ? rect.y + rect.height / 2 : rect.y - 8
          out.push(
            <text key={`l${si}-${i}`} x={tx} y={ty} textAnchor={horizontal && !inside ? 'start' : 'middle'} dominantBaseline={horizontal || inside ? 'central' : 'auto'} fontSize={dl.size} fill={dl.color} fontWeight={dl.bold ? 700 : 400}>
              {label}
            </text>,
          )
        }
      }
    })
  } else {
    const base = Array<number>(n).fill(0)
    spec.series.forEach((s, si) => {
      const pts: [number, number][] = []
      for (let i = 0; i < n; i++) {
        const v = s.values[i]
        if (v === null || v === undefined) continue
        const val = stacked ? (base[i] += value(s, i)) : value(s, i)
        pts.push(valuePt(pos(val), (catIndex(i) + 0.5) * band))
      }
      if (!pts.length) return
      const d = `M${pts.map((p) => p.join(',')).join(' L')}`
      if (spec.type === 'area') {
        const [bx0, by0] = valuePt(pos(0), (catIndex(0) + 0.5) * band)
        const [bx1, by1] = valuePt(pos(0), (catIndex(n - 1) + 0.5) * band)
        out.push(<path key={`a${si}`} d={`${d} L${bx1},${by1} L${bx0},${by0} Z`} fill={s.color} opacity={0.85} />)
      } else if (s.line !== null) out.push(<path key={`p${si}`} d={d} fill="none" stroke={s.line?.color ?? s.color} strokeWidth={s.line?.w ?? 3} strokeLinejoin="round" />)
      if (s.marker) pts.forEach(([x, y], i) => out.push(<MarkerShape key={`m${si}-${i}`} m={s.marker!} x={x} y={y} color={s.color} />))
      if (dl)
        pts.forEach(([x, y], i) =>
          out.push(
            <text key={`l${si}-${i}`} x={x} y={y - 12} textAnchor="middle" fontSize={dl.size} fill={dl.color} fontWeight={dl.bold ? 700 : 400}>
              {formatNumber(s.values[i] ?? 0, dl.numFmt)}
            </text>,
          ),
        )
    })
  }
  return <g>{out}</g>
}

function Scatter({ spec, plot }: { spec: Spec; plot: Plot }) {
  const xs = spec.series.flatMap((s) => (s.xValues ?? s.values.map((_, i) => i + 1)).filter((v): v is number => v !== null))
  const ys = spec.series.flatMap((s) => s.values.filter((v): v is number => v !== null))
  const xa = spec.catAxis
  const ya = spec.valAxis
  const xs_ = niceScale(Math.min(...xs, 0), Math.max(...xs, 1), xa)
  const ys_ = niceScale(Math.min(...ys, 0), Math.max(...ys, 1), ya)
  const X = (v: number) => plot.x + ((v - xs_.min) / (xs_.max - xs_.min)) * plot.w
  const Y = (v: number) => plot.y + plot.h - ((v - ys_.min) / (ys_.max - ys_.min)) * plot.h
  const out: React.ReactNode[] = []
  if (xa?.gridColor) xs_.ticks.forEach((t, k) => out.push(<line key={`gx${k}`} x1={X(t)} x2={X(t)} y1={plot.y} y2={plot.y + plot.h} stroke={xa.gridColor} strokeWidth={1} />))
  if (ya?.gridColor) ys_.ticks.forEach((t, k) => out.push(<line key={`gy${k}`} y1={Y(t)} y2={Y(t)} x1={plot.x} x2={plot.x + plot.w} stroke={ya.gridColor} strokeWidth={1} />))
  if (xa?.lineColor) out.push(<line key="xa" x1={plot.x} x2={plot.x + plot.w} y1={plot.y + plot.h} y2={plot.y + plot.h} stroke={xa.lineColor} strokeWidth={1.5} />)
  if (xa?.visible !== false)
    xs_.ticks.forEach((t, k) =>
      out.push(
        <text key={`xl${k}`} x={X(t)} y={plot.y + plot.h + (xa?.labelSize ?? 20) * 1.4} textAnchor="middle" fontSize={xa?.labelSize} fill={xa?.labelColor}>
          {formatNumber(t, xa?.numFmt)}
        </text>,
      ),
    )
  if (ya?.visible !== false)
    ys_.ticks.forEach((t, k) =>
      out.push(
        <text key={`yl${k}`} x={plot.x - 8} y={Y(t)} textAnchor="end" dominantBaseline="central" fontSize={ya?.labelSize} fill={ya?.labelColor}>
          {formatNumber(t, ya?.numFmt)}
        </text>,
      ),
    )
  spec.series.forEach((s, si) => {
    const pts = s.values.map((v, i) => [s.xValues?.[i] ?? i + 1, v] as const).filter((p): p is readonly [number, number] => p[0] !== null && p[1] !== null)
    if (s.line && pts.length > 1) out.push(<path key={`p${si}`} d={`M${pts.map(([x, y]) => `${X(x)},${Y(y)}`).join(' L')}`} fill="none" stroke={s.line.color} strokeWidth={s.line.w} />)
    if (s.marker !== null) pts.forEach(([x, y], i) => out.push(<MarkerShape key={`m${si}-${i}`} m={s.marker ?? { symbol: 'circle', size: 14, fill: s.color }} x={X(x)} y={Y(y)} color={s.color} />))
  })
  return <g>{out}</g>
}

function Pie({ spec, plot }: { spec: Spec; plot: Plot }) {
  const s = spec.series[0]
  if (!s) return null
  const vals = s.values.map((v) => Math.max(0, v ?? 0))
  const total = vals.reduce((a, b) => a + b, 0) || 1
  const r = Math.min(plot.w, plot.h) / 2
  const cx = plot.x + plot.w / 2
  const cy = plot.y + plot.h / 2
  const hole = spec.type === 'doughnut' ? (r * spec.holeSize) / 100 : 0
  let a0 = -Math.PI / 2
  const dl = spec.dataLabels
  return (
    <g>
      {vals.map((v, i) => {
        const a1 = a0 + (v / total) * Math.PI * 2
        const large = a1 - a0 > Math.PI ? 1 : 0
        const p = (rad: number, a: number) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`
        const d = hole
          ? `M${p(r, a0)} A${r},${r} 0 ${large} 1 ${p(r, a1)} L${p(hole, a1)} A${hole},${hole} 0 ${large} 0 ${p(hole, a0)} Z`
          : `M${cx},${cy} L${p(r, a0)} A${r},${r} 0 ${large} 1 ${p(r, a1)} Z`
        const mid = (a0 + a1) / 2
        a0 = a1
        const lr = hole ? (r + hole) / 2 : r * 0.65
        return (
          <g key={i}>
            <path d={d} fill={s.pointColors?.[i] ?? s.color} stroke="#fff" strokeWidth={2} />
            {dl && v > 0 && (
              <text x={cx + lr * Math.cos(mid)} y={cy + lr * Math.sin(mid)} textAnchor="middle" dominantBaseline="central" fontSize={dl.size} fill={dl.color} fontWeight={dl.bold ? 700 : 400}>
                {formatNumber(s.values[i] ?? 0, dl.numFmt)}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
}
