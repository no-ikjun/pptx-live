import { createContext, useContext, type CSSProperties, type ReactNode } from 'react'
import type { Cell, ChartNode, Fill, GroupNode, ImageNode, Para, Run, Shape, ShapeNode, Stroke, TableNode, TextBody, VideoNode } from '../model'
import { ChartView } from './Chart'
import { fontStack } from './fonts'

// Pretendard and most UI fonts have ascent + descent ≈ 1.2em, which PowerPoint
// treats as single line spacing.
const SINGLE_LINE = 1.2

/** Resolves "media/x.png" in deck JSON to a served URL. */
export const MediaContext = createContext<(src: string) => string>((s) => s)
const useMedia = () => useContext(MediaContext)

// ---- overrides (used by a deck's live.tsx) -------------------------------------

export type ParaOverride = (p: Para, i: number) => ReactNode | undefined
export type BoxOverride = { para?: ParaOverride; fill?: string; children?: ReactNode }
export type CellOverride = { para?: ParaOverride; fill?: string }

export type SlideOverrides = {
  /** Replace a shape entirely. Return null to hide it, undefined to keep it. */
  replace?: (s: Shape) => ReactNode | null | undefined
  /** Change the text or fill of a shape. */
  box?: (s: ShapeNode) => BoxOverride | undefined
  /** Change the text or fill of one table cell. */
  cell?: (t: TableNode, row: number, col: number) => CellOverride | undefined
  /** Swap a chart's data (or anything else in its spec). */
  chart?: (c: ChartNode) => ChartNode['chart'] | undefined
  /** Turn off the PPT's own build animations on this slide. */
  builds?: false
}

/** Per-shape animation state from the build sequence (see builds.ts). */
export type AnimState = Map<string, CSSProperties | 'hidden'>

type Ctx = { o?: SlideOverrides; anim?: AnimState; uid: string }

// ---- paint helpers -------------------------------------------------------------

export function fillCss(fill: Fill | undefined, media: (s: string) => string): CSSProperties {
  if (!fill) return {}
  if (fill.type === 'solid') return { background: fill.color }
  if (fill.type === 'gradient') {
    const stops = fill.stops.map((s) => `${s.color} ${s.pos}%`).join(', ')
    return { background: fill.kind === 'radial' ? `radial-gradient(circle, ${stops})` : `linear-gradient(${fill.angle + 90}deg, ${stops})` }
  }
  return {
    backgroundImage: `url("${media(fill.src)}")`,
    backgroundSize: fill.tile ? 'auto' : '100% 100%',
    backgroundRepeat: fill.tile ? 'repeat' : 'no-repeat',
  }
}

const DASHES: Record<string, number[]> = {
  dash: [4, 3], sysDash: [3, 1], sysDot: [1, 1], dot: [1, 3], lgDash: [8, 3], dashDot: [4, 3, 1, 3],
  lgDashDot: [8, 3, 1, 3], lgDashDotDot: [8, 3, 1, 3, 1, 3], sysDashDot: [3, 1, 1, 1], sysDashDotDot: [3, 1, 1, 1, 1, 1],
}
function dashArray(s: Stroke) {
  const d = s.dash ? DASHES[s.dash] : undefined
  return d ? d.map((v) => v * Math.max(s.w, 1)).join(' ') : undefined
}

function strokeOverlay(stroke: Stroke | undefined, radius?: number | string): ReactNode {
  if (!stroke || stroke.w <= 0) return null
  const pad = stroke.w / 2
  if (stroke.dash) {
    // CSS dashes are much shorter than PowerPoint's, so draw dashed outlines in SVG.
    const ellipse = radius === '50%'
    return (
      <svg style={{ position: 'absolute', inset: -pad, overflow: 'visible', pointerEvents: 'none' }} width={`calc(100% + ${stroke.w}px)`} height={`calc(100% + ${stroke.w}px)`}>
        <rect
          x={pad}
          y={pad}
          width={`calc(100% - ${stroke.w}px)`}
          height={`calc(100% - ${stroke.w}px)`}
          rx={ellipse ? '50%' : typeof radius === 'number' ? radius : 0}
          fill="none"
          stroke={stroke.color}
          strokeWidth={stroke.w}
          strokeDasharray={dashArray(stroke)}
        />
      </svg>
    )
  }
  return (
    <div
      style={{
        position: 'absolute',
        inset: -pad,
        border: `${stroke.w}px solid ${stroke.color}`,
        borderRadius: typeof radius === 'number' ? radius + pad : radius,
        pointerEvents: 'none',
      }}
    />
  )
}

function frameStyle(s: Shape, extra?: CSSProperties | 'hidden'): CSSProperties {
  const t: string[] = []
  if (s.rot) t.push(`rotate(${s.rot}deg)`)
  if (s.flipH) t.push('scaleX(-1)')
  if (s.flipV) t.push('scaleY(-1)')
  const base: CSSProperties = { position: 'absolute', left: s.x, top: s.y, width: s.w, height: s.h }
  const anim = extra && extra !== 'hidden' ? extra : undefined
  if (anim?.transform) t.push(String(anim.transform))
  return { ...base, ...anim, transform: t.length ? t.join(' ') : undefined }
}

// ---- text ----------------------------------------------------------------------

function maxSize(p: Para) {
  return Math.max(...p.runs.map((r) => r.size || 0), 1)
}
function spacing(s: Para['spaceBefore'], p: Para) {
  if (!s) return 0
  if (s.px !== undefined) return s.px
  return (s.pct ?? 0) * maxSize(p) * SINGLE_LINE
}
function lineHeight(p: Para) {
  if (p.lineSpacing.px !== undefined) return p.lineSpacing.px
  return (p.lineSpacing.pct ?? 1) * SINGLE_LINE * maxSize(p)
}

const ALIGN: Record<Para['align'], CSSProperties['textAlign']> = { l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify' }

export function RunSpan({ r }: { r: Run }) {
  if (r.br) return <br />
  const font = fontStack(r.font, r.bold)
  const deco = [r.underline && 'underline', r.strike && 'line-through'].filter(Boolean).join(' ')
  const style: CSSProperties = {
    fontSize: r.size,
    fontFamily: font.family,
    fontWeight: font.weight,
    color: r.color,
    letterSpacing: r.spacing ? `${r.spacing}px` : undefined,
    fontStyle: r.italic ? 'italic' : undefined,
    textDecoration: deco || undefined,
    textTransform: r.caps ? 'uppercase' : undefined,
    background: r.highlight,
    position: r.baseline ? 'relative' : undefined,
    top: r.baseline ? -r.baseline * r.size * 0.8 : undefined,
  }
  // A trailing line break needs something after it to take up a line in HTML.
  const t = r.t ? (r.t.endsWith('\n') ? r.t + '\u200B' : r.t) : '\u200B'
  if (r.link)
    return (
      <a href={r.link} target="_blank" rel="noreferrer" style={{ ...style, cursor: 'pointer' }} onClick={(e) => e.stopPropagation()}>
        {t}
      </a>
    )
  return <span style={style}>{t}</span>
}

export function Paragraph({ p, first, nowrap, children }: { p: Para; first: boolean; nowrap?: boolean; children?: ReactNode }) {
  const style: CSSProperties = {
    margin: 0,
    textAlign: ALIGN[p.align] ?? 'left',
    // The paragraph's own font size sets the line strut; matching the largest
    // run keeps each line box at exactly lineHeight.
    fontSize: maxSize(p),
    lineHeight: `${lineHeight(p)}px`,
    paddingLeft: p.marL,
    textIndent: p.bullet ? undefined : p.indent || undefined,
    marginTop: first ? 0 : spacing(p.spaceBefore, p),
    marginBottom: spacing(p.spaceAfter, p),
    whiteSpace: nowrap ? 'pre' : 'pre-wrap',
    position: 'relative',
    // PowerPoint wraps CJK text between any two characters.
    wordBreak: 'normal',
    overflowWrap: 'anywhere',
  }
  return (
    <p style={style}>
      {p.bullet && (
        <span
          style={{
            position: 'absolute',
            left: p.marL + Math.min(p.indent, 0),
            color: p.bullet.color,
            fontSize: p.bullet.size,
            fontFamily: p.bullet.font ? fontStack(p.bullet.font, false).family : 'Arial, sans-serif',
          }}
        >
          {p.bullet.text}
        </span>
      )}
      {children ?? p.runs.map((r, i) => <RunSpan key={i} r={r} />)}
    </p>
  )
}

const ANCHOR: Record<TextBody['anchor'], CSSProperties['justifyContent']> = { t: 'flex-start', ctr: 'center', b: 'flex-end' }

export function TextFrame({ body, override }: { body: TextBody; override?: ParaOverride }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: ANCHOR[body.anchor] ?? 'flex-start',
        alignItems: body.anchorCtr ? 'center' : 'stretch',
        padding: `${body.insets.t}px ${body.insets.r}px ${body.insets.b}px ${body.insets.l}px`,
        writingMode: body.vertical ? 'vertical-rl' : undefined,
      }}
    >
      <div>
        {body.paras.map((p, i) => (
          <Paragraph key={i} p={p} first={i === 0} nowrap={!body.wrap}>
            {override?.(p, i)}
          </Paragraph>
        ))}
      </div>
    </div>
  )
}

// ---- shapes ----------------------------------------------------------------------

function Marker({ id, type, color }: { id: string; type: string; color: string }) {
  const shape =
    type === 'oval' ? <circle cx="5" cy="5" r="4" fill={color} /> : type === 'diamond' ? <path d="M5,0 L10,5 L5,10 L0,5 z" fill={color} /> : <path d="M0,0 L10,5 L0,10 z" fill={color} />
  return (
    <marker id={id} viewBox="0 0 10 10" refX={type === 'oval' || type === 'diamond' ? 5 : 8} refY="5" markerWidth="3" markerHeight="3" orient="auto-start-reverse" markerUnits="strokeWidth">
      {shape}
    </marker>
  )
}

function svgPaint(fill: Fill | undefined, id: string, w: number, h: number, media: (s: string) => string): { def?: ReactNode; paint: string } {
  if (!fill) return { paint: 'none' }
  if (fill.type === 'solid') return { paint: fill.color }
  if (fill.type === 'gradient') {
    const stops = fill.stops.map((s, i) => <stop key={i} offset={`${s.pos}%`} stopColor={s.color} />)
    if (fill.kind === 'radial') return { def: <radialGradient id={id}>{stops}</radialGradient>, paint: `url(#${id})` }
    const a = (fill.angle * Math.PI) / 180
    const [dx, dy] = [Math.cos(a), Math.sin(a)]
    return {
      def: (
        <linearGradient id={id} x1={0.5 - dx / 2} y1={0.5 - dy / 2} x2={0.5 + dx / 2} y2={0.5 + dy / 2}>
          {stops}
        </linearGradient>
      ),
      paint: `url(#${id})`,
    }
  }
  return {
    def: (
      <pattern id={id} patternUnits="userSpaceOnUse" width={w} height={h}>
        <image href={media(fill.src)} width={w} height={h} preserveAspectRatio="none" />
      </pattern>
    ),
    paint: `url(#${id})`,
  }
}

function ShapeBox({ s, ctx }: { s: ShapeNode; ctx: Ctx }) {
  const media = useMedia()
  const o = ctx.o?.box?.(s)
  const fill: Fill | undefined = o?.fill ? { type: 'solid', color: o.fill } : s.fill
  const anim = ctx.anim?.get(s.id)
  const link = s.link ? { cursor: 'pointer' } : {}
  const onClick = s.link
    ? (e: React.MouseEvent) => {
        e.stopPropagation()
        window.open(s.link, '_blank', 'noreferrer')
      }
    : undefined

  if (typeof s.geom === 'object' && 'paths' in s.geom) {
    const id = `${ctx.uid}-${s.id}`
    const paint = svgPaint(fill, `${id}-f`, s.w, s.h, media)
    const st = s.stroke
    const pad = st ? Math.max(st.w * 6, 4) : 0
    return (
      <div data-name={s.name} style={{ ...frameStyle(s, anim), ...link }} onClick={onClick}>
        <svg style={{ position: 'absolute', left: -pad, top: -pad, overflow: 'visible' }} width={s.w + pad * 2} height={s.h + pad * 2}>
          <defs>
            {paint.def}
            {st?.head && <Marker id={`${id}-h`} type={st.head} color={st.color} />}
            {st?.tail && <Marker id={`${id}-t`} type={st.tail} color={st.color} />}
          </defs>
          <g transform={`translate(${pad},${pad})`}>
            {s.geom.paths.map((p, i) => (
              <path
                key={i}
                d={p.d}
                fill={p.fill && p.closed ? paint.paint : 'none'}
                stroke={p.stroke && st ? st.color : 'none'}
                strokeWidth={st?.w}
                strokeDasharray={st ? dashArray(st) : undefined}
                strokeLinecap={st?.cap}
                strokeLinejoin="round"
                markerStart={!p.closed && st?.head ? `url(#${id}-h)` : undefined}
                markerEnd={!p.closed && st?.tail ? `url(#${id}-t)` : undefined}
              />
            ))}
          </g>
        </svg>
        {s.text && <TextFrame body={s.text} override={o?.para} />}
        {o?.children}
      </div>
    )
  }
  const radius = s.geom === 'ellipse' ? '50%' : typeof s.geom === 'object' && 'radius' in s.geom ? s.geom.radius : undefined
  return (
    <div data-name={s.name} style={{ ...frameStyle(s, anim), ...fillCss(fill, media), borderRadius: radius, ...link }} onClick={onClick}>
      {strokeOverlay(s.stroke, radius)}
      {s.text && <TextFrame body={s.text} override={o?.para} />}
      {o?.children}
    </div>
  )
}

function ImageView({ s, ctx }: { s: ImageNode; ctx: Ctx }) {
  const media = useMedia()
  const c = { l: 0, t: 0, r: 0, b: 0, ...s.crop }
  const fullW = s.w / (1 - c.l - c.r || 1)
  const fullH = s.h / (1 - c.t - c.b || 1)
  const radius = s.clip === 'ellipse' ? '50%' : s.clip ? s.clip.radius : undefined
  return (
    <div data-name={s.name} style={{ ...frameStyle(s, ctx.anim?.get(s.id)), overflow: 'hidden', borderRadius: radius }}>
      <img
        src={media(s.src)}
        alt=""
        draggable={false}
        style={{ position: 'absolute', left: -c.l * fullW, top: -c.t * fullH, width: fullW, height: fullH, maxWidth: 'none', opacity: s.opacity }}
      />
      {strokeOverlay(s.stroke, radius)}
    </div>
  )
}

function VideoView({ s, ctx }: { s: VideoNode; ctx: Ctx }) {
  const media = useMedia()
  return (
    <div data-name={s.name} style={frameStyle(s, ctx.anim?.get(s.id))} onClick={(e) => e.stopPropagation()}>
      <video src={media(s.src)} poster={s.poster ? media(s.poster) : undefined} controls playsInline style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} />
    </div>
  )
}

const border = (b?: Stroke) => (b ? `${b.w}px solid ${b.color}` : undefined)

function CellView({ c, w, h, o }: { c: Cell; w: number; h: number; o?: CellOverride }) {
  const media = useMedia()
  const fill = o?.fill ? { background: o.fill } : fillCss(c.fill, media)
  return (
    <td
      colSpan={c.colSpan}
      rowSpan={c.rowSpan}
      style={{
        width: w,
        height: h,
        padding: `${c.pad.t}px ${c.pad.r}px ${c.pad.b}px ${c.pad.l}px`,
        ...fill,
        borderTop: border(c.borders.top),
        borderBottom: border(c.borders.bottom),
        borderLeft: border(c.borders.left),
        borderRight: border(c.borders.right),
        verticalAlign: c.anchor === 'ctr' ? 'middle' : c.anchor === 'b' ? 'bottom' : 'top',
      }}
    >
      {c.paras.map((p, i) => (
        <Paragraph key={i} p={p} first={i === 0}>
          {o?.para?.(p, i)}
        </Paragraph>
      ))}
    </td>
  )
}

function TableView({ s, ctx }: { s: TableNode; ctx: Ctx }) {
  return (
    <div data-name={s.name} style={{ ...frameStyle(s, ctx.anim?.get(s.id)), height: undefined }}>
      <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: s.cols.reduce((a, b) => a + b, 0) }}>
        <colgroup>
          {s.cols.map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <tbody>
          {s.rows.map((r, ri) => (
            <tr key={ri} style={{ height: r.h }}>
              {r.cells.map((c, ci) =>
                c.merged ? null : <CellView key={ci} c={c} w={s.cols[ci]} h={r.h} o={ctx.o?.cell?.(s, ri, ci)} />,
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GroupView({ s, ctx }: { s: GroupNode; ctx: Ctx }) {
  return (
    <div data-name={s.name} style={frameStyle(s, ctx.anim?.get(s.id))}>
      {s.children.map((c, i) => (
        <ShapeView key={i} s={c} ctx={ctx} />
      ))}
    </div>
  )
}

export function ShapeView({ s, ctx }: { s: Shape; ctx: Ctx }) {
  const replaced = ctx.o?.replace?.(s)
  if (replaced !== undefined) return <>{replaced}</>
  if (ctx.anim?.get(s.id) === 'hidden') return null
  switch (s.kind) {
    case 'shape':
      return <ShapeBox s={s} ctx={ctx} />
    case 'image':
      return <ImageView s={s} ctx={ctx} />
    case 'video':
      return <VideoView s={s} ctx={ctx} />
    case 'table':
      return <TableView s={s} ctx={ctx} />
    case 'group':
      return <GroupView s={s} ctx={ctx} />
    case 'chart': {
      const spec = ctx.o?.chart?.(s) ?? s.chart
      return (
        <div data-name={s.name} style={frameStyle(s, ctx.anim?.get(s.id))}>
          <ChartView spec={spec} w={s.w} h={s.h} />
        </div>
      )
    }
  }
}

/** Renders one slide's shapes; the caller sizes and scales the 1920-wide stage. */
export function SlideShapes({ shapes, o, anim, uid }: { shapes: Shape[]; o?: SlideOverrides; anim?: AnimState; uid: string }) {
  const ctx: Ctx = { o, anim, uid }
  return (
    <>
      {shapes.map((s, i) => (
        <ShapeView key={i} s={s} ctx={ctx} />
      ))}
    </>
  )
}

/** Draws one shape outside a slide's normal flow (e.g. a resized copy in live code). */
export function BoxView({ s }: { s: ShapeNode }) {
  return <ShapeBox s={s} ctx={{ uid: `box-${s.id}` }} />
}
