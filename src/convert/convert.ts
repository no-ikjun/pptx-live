import type { Cell, Crop, Deck, Fill, GroupNode, Para, Run, Shape, ShapeNode, Slide, Stroke, TableNode, TextBody } from '../model'
import { readAnimations } from './anim'
import { readChart } from './chart'
import { readColor, type Scheme } from './color'
import { customPath, presetPath, readAdjust } from './geometry'
import { Package, type Rels } from './package'
import { attr, child, children, find, findAll, is, kids, num, resolveAlternate, text, type El } from './xml'

export type ConvertResult = { deck: Deck; media: { name: string; bytes: Uint8Array }[] }

const STAGE_W = 1920
const MEDIA_EXT = /\.(png|jpe?g|gif|svg|webp|bmp|tiff?|emf|wmf|wdp|jxr|mp4|m4v|mov|webm|mp3|m4a|wav)$/i
const SUPPORTED_EXT = new Set(['a14', 'p14', 'p15', 'v', 'asvg', 'a16'])
const SHAPE_TAGS = new Set(['sp', 'pic', 'grpSp', 'graphicFrame', 'cxnSp', 'AlternateContent', 'contentPart'])

// ---- small helpers -------------------------------------------------------------

/** Child by local name, ignoring the namespace (p:, dsp: and a: variants share local names). */
function lc(el: El | null | undefined, local: string): El | null {
  if (!el) return null
  for (const c of children(el)) if (c.localName === local) return c
  return null
}
function lcPath(el: El | null | undefined, path: string): El | null {
  let cur: El | null | undefined = el
  for (const p of path.split('/')) cur = lc(cur, p)
  return cur ?? null
}

type Theme = {
  scheme: Scheme
  major: { latin: string; ea: string }
  minor: { latin: string; ea: string }
  fills: El[]
  lines: El[]
  bgFills: El[]
}

type PlaceholderKey = { type: string; idx: string | null }

type TextDefaults = { color?: string; font?: 'major' | 'minor' }

// Paragraph/run property bags collected while walking the inheritance chain.
type PProps = Partial<Omit<Para, 'runs' | 'bullet'>> & {
  bulletChar?: string | false
  bulletAuto?: { type: string; start: number }
  bulletFont?: string
  bulletColor?: string
  bulletSizePct?: number
  bulletSizePx?: number
}
type RProps = Partial<Omit<Run, 't' | 'br'>> & { latin?: string; ea?: string }

// Common symbol-font bullets mapped to Unicode.
const SYMBOL_BULLETS: Record<string, string> = {
  l: '●', n: '■', q: '❑', u: '◆', v: '❖', Ø: '➢', ü: '✓', '§': '▪', w: '⬥', Ÿ: '•', o: '○', p: '□',
  // Symbol fonts are often stored in the private-use area (U+F0xx).
  '': '●', '': '■', '': '❑', '': '◆', '': '❖', '': '➢', '': '✓', '': '▪', '': '•', '': '•',
}

class Converter {
  pkg: Package
  emu: number
  pt: number
  height: number
  warnings = new Set<string>()
  fonts: string[] = []
  fontKinds: Record<string, 'serif' | 'mono'> = {}
  media = new Map<string, { name: string; bytes: Uint8Array }>()
  themes = new Map<string, Theme>()
  tableStyles = new Map<string, El>()
  defaultTextStyle: El | null
  // Per-slide state
  slidePath = ''
  slideNumber = 0

  constructor(pkg: Package) {
    this.pkg = pkg
    const pres = pkg.xml('ppt/presentation.xml')!
    const sz = child(pres, 'p:sldSz')
    const cx = num(sz, 'cx', 12192000)
    const cy = num(sz, 'cy', 6858000)
    this.emu = cx / STAGE_W
    this.pt = 12700 / this.emu
    this.height = Math.round(cy / this.emu)
    this.defaultTextStyle = child(pres, 'p:defaultTextStyle')
    const ts = pkg.rels('ppt/presentation.xml').ofType('/tableStyles')
    for (const s of kids(ts ? pkg.xml(ts) : null, 'a:tblStyle')) this.tableStyles.set(attr(s, 'styleId') ?? '', s)
  }

  px(v: string | number | null | undefined) {
    return Math.round((Number(v ?? 0) / this.emu) * 100) / 100
  }

  warn(msg: string) {
    this.warnings.add(msg)
  }

  useFont(name: string | undefined) {
    if (name && !this.fonts.includes(name)) this.fonts.push(name)
  }

  /** Records whether a font is serif or monospaced from its PANOSE code. */
  classify(el: El | null) {
    const name = attr(el, 'typeface')
    const panose = attr(el, 'panose')
    if (!name || !panose || panose.length < 8 || name.startsWith('+')) return
    const family = parseInt(panose.slice(0, 2), 16)
    const serif = parseInt(panose.slice(2, 4), 16)
    const proportion = parseInt(panose.slice(6, 8), 16)
    if (family !== 2) return
    if (proportion === 9) this.fontKinds[name] = 'mono'
    else if (serif >= 2 && serif <= 10) this.fontKinds[name] = 'serif'
  }

  // ---- parts -------------------------------------------------------------------

  layoutOf(path: string) {
    const rels = this.pkg.rels(path)
    return rels.ofType('/slideLayout') ?? rels.ofType('/slideMaster')
  }

  masterOf(path: string): string {
    let p: string | undefined = path
    while (p && !p.includes('slideMasters/')) p = this.layoutOf(p)
    return p ?? ''
  }

  theme(masterPath: string): Theme {
    if (this.themes.has(masterPath)) return this.themes.get(masterPath)!
    const master = this.pkg.xml(masterPath)!
    const themePath = this.pkg.rels(masterPath).ofType('/theme')
    const th = themePath ? this.pkg.xml(themePath) : null
    const raw: Scheme = {}
    for (const el of children(find(th, 'a:clrScheme'))) {
      const c = readColor(el, {})
      if (c) raw[el.localName] = c
    }
    const map = child(master, 'p:clrMap')
    const scheme: Scheme = { ...raw }
    for (const key of ['bg1', 'tx1', 'bg2', 'tx2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']) {
      const to = attr(map, key) ?? key
      if (raw[to]) scheme[key] = raw[to]
    }
    const fontOf = (el: El | null) => {
      this.classify(child(el, 'a:latin'))
      const latin = attr(child(el, 'a:latin'), 'typeface') ?? ''
      let ea = attr(child(el, 'a:ea'), 'typeface') ?? ''
      if (!ea) ea = attr(kids(el, 'a:font').find((f) => attr(f, 'script') === 'Hang') ?? null, 'typeface') ?? ''
      return { latin, ea }
    }
    const fmt = find(th, 'a:fmtScheme')
    const t: Theme = {
      scheme,
      major: fontOf(find(th, 'a:majorFont')),
      minor: fontOf(find(th, 'a:minorFont')),
      fills: children(child(fmt, 'a:fillStyleLst')),
      lines: kids(child(fmt, 'a:lnStyleLst'), 'a:ln'),
      bgFills: children(child(fmt, 'a:bgFillStyleLst')),
    }
    this.themes.set(masterPath, t)
    return t
  }

  get th() {
    return this.theme(this.masterOf(this.slidePath))
  }

  mediaRef(partPath: string, rid: string | null): string | undefined {
    const target = this.pkg.rels(partPath).target(rid)
    if (!target) return undefined
    const existing = this.media.get(target)
    if (existing) return 'media/' + existing.name
    const bytes = this.pkg.bytes(target)
    if (!bytes) {
      this.warn(`Missing media file ${target}`)
      return undefined
    }
    let base = target.split('/').pop()!.replace(/[?#&].*$/, '')
    if (!MEDIA_EXT.test(base)) base = base.replace(/\.[^.]*$/, '') + sniffExt(bytes)
    if (/\.(wdp|jxr|tiff?)$/i.test(base)) this.warn(`${base} is in a format browsers cannot show`)
    let name = base
    for (let i = 2; [...this.media.values()].some((m) => m.name === name); i++) name = base.replace(/(\.\w+)$/, `-${i}$1`)
    this.media.set(target, { name, bytes })
    return 'media/' + name
  }

  // ---- paint -------------------------------------------------------------------

  /** undefined = not specified here; null = explicitly none; 'group' = use the group's fill. */
  readFill(container: El | null, part: string, ph?: string): Fill | null | 'group' | undefined {
    if (!container) return undefined
    for (const c of children(container)) {
      if (is(c, 'a:noFill')) return null
      if (is(c, 'a:grpFill')) return 'group'
      if (is(c, 'a:solidFill')) {
        const color = readColor(c, this.th.scheme, ph)
        return color ? { type: 'solid', color } : null
      }
      if (is(c, 'a:pattFill')) {
        const color = readColor(child(c, 'a:fgClr'), this.th.scheme, ph)
        return color ? { type: 'solid', color } : null
      }
      if (is(c, 'a:gradFill')) {
        const stops = kids(child(c, 'a:gsLst'), 'a:gs')
          .map((g) => ({ pos: num(g, 'pos', 0) / 1000, color: readColor(g, this.th.scheme, ph) ?? '#000000' }))
          .sort((a, b) => a.pos - b.pos)
        if (!stops.length) return null
        const lin = child(c, 'a:lin')
        const path = child(c, 'a:path')
        return { type: 'gradient', kind: path && !lin ? 'radial' : 'linear', angle: num(lin, 'ang', 0) / 60000, stops }
      }
      if (is(c, 'a:blipFill')) {
        const img = this.readBlip(c, part)
        if (!img) return null
        return { type: 'image', src: img.src, tile: !!child(c, 'a:tile'), opacity: img.opacity, crop: img.crop }
      }
    }
    return undefined
  }

  readBlip(blipFill: El, part: string): { src: string; opacity?: number; crop?: Crop } | null {
    const blip = child(blipFill, 'a:blip')
    if (!blip) return null
    // Prefer the SVG original when PowerPoint stored one next to the PNG.
    const svg = find(blip, 'asvg:svgBlip')
    const src = this.mediaRef(part, attr(svg, 'r:embed') ?? attr(blip, 'r:embed') ?? attr(blip, 'r:link'))
    if (!src) return null
    const alpha = child(blip, 'a:alphaModFix')
    const rect = child(blipFill, 'a:srcRect')
    const crop = rect
      ? { l: num(rect, 'l', 0) / 100000, t: num(rect, 't', 0) / 100000, r: num(rect, 'r', 0) / 100000, b: num(rect, 'b', 0) / 100000 }
      : undefined
    return { src, opacity: alpha ? num(alpha, 'amt', 100000) / 100000 : undefined, crop }
  }

  readStroke(ln: El | null, ph?: string): Stroke | null | undefined {
    if (!ln) return undefined
    if (child(ln, 'a:noFill')) return null
    const solid = child(ln, 'a:solidFill')
    const grad = child(ln, 'a:gradFill')
    let color = solid ? readColor(solid, this.th.scheme, ph) : null
    if (!color && grad) color = readColor(kids(child(grad, 'a:gsLst'), 'a:gs')[0] ?? null, this.th.scheme, ph)
    const hasWidth = attr(ln, 'w') !== null
    if (!color && !hasWidth && !child(ln, 'a:prstDash') && !child(ln, 'a:tailEnd') && !child(ln, 'a:headEnd')) return undefined
    const s: Stroke = { w: this.px(num(ln, 'w', 9525)), color: color ?? '' }
    const dash = attr(child(ln, 'a:prstDash'), 'val')
    if (dash && dash !== 'solid') s.dash = dash
    const head = attr(child(ln, 'a:headEnd'), 'type')
    const tail = attr(child(ln, 'a:tailEnd'), 'type')
    if (head && head !== 'none') s.head = head
    if (tail && tail !== 'none') s.tail = tail
    const cap = attr(ln, 'cap')
    if (cap === 'rnd') s.cap = 'round'
    else if (cap === 'sq') s.cap = 'square'
    return s
  }

  /** Resolves <p:style> references against the theme's format scheme. */
  styleRefs(style: El | null) {
    const out: { fill?: Fill | null; stroke?: Stroke | null; fontColor?: string; font?: 'major' | 'minor' } = {}
    if (!style) return out
    const th = this.th
    const fillRef = child(style, 'a:fillRef')
    const fIdx = num(fillRef, 'idx', 0)
    if (fillRef && fIdx > 0) {
      const ph = readColor(fillRef, th.scheme) ?? undefined
      const src = th.fills[fIdx - 1]
      const f = src ? this.readFill(wrap(src), this.slidePath, ph) : undefined
      out.fill = f === 'group' ? undefined : f
    }
    const lnRef = child(style, 'a:lnRef')
    const lIdx = num(lnRef, 'idx', 0)
    if (lnRef && lIdx > 0) {
      const ph = readColor(lnRef, th.scheme) ?? undefined
      const src = th.lines[lIdx - 1]
      const s = src ? this.readStroke(src, ph) : undefined
      if (s && !s.color) s.color = ph ?? '#000000'
      out.stroke = s
    }
    const fontRef = child(style, 'a:fontRef')
    if (fontRef) {
      out.fontColor = readColor(fontRef, th.scheme) ?? undefined
      const idx = attr(fontRef, 'idx')
      if (idx === 'major' || idx === 'minor') out.font = idx
    }
    return out
  }

  // ---- placeholders --------------------------------------------------------------

  phKey(sp: El): PlaceholderKey | null {
    const ph = find(lc(sp, 'nvSpPr') ?? lc(sp, 'nvPicPr') ?? lc(sp, 'nvGraphicFramePr'), 'p:ph')
    if (!ph) return null
    return { type: attr(ph, 'type') ?? 'body', idx: attr(ph, 'idx') }
  }

  findPlaceholder(partPath: string | undefined, key: PlaceholderKey, byTypeOnly = false): El | null {
    if (!partPath) return null
    const root = this.pkg.xml(partPath)
    const sps = findAll(root, 'p:sp')
    const typeOf = (t: string) => (t === 'ctrTitle' ? 'title' : t === 'subTitle' || t === 'obj' ? 'body' : t)
    if (!byTypeOnly && key.idx !== null) {
      const hit = sps.find((s) => this.phKey(s)?.idx === key.idx)
      if (hit) return hit
    }
    return sps.find((s) => {
      const k = this.phKey(s)
      return k && typeOf(k.type) === typeOf(key.type)
    }) ?? null
  }

  /** [master, layout, slide] elements for a placeholder, most general first. */
  chain(partPath: string, sp: El): { el: El; part: string }[] {
    const key = this.phKey(sp)
    const out = [{ el: sp, part: partPath }]
    if (!key || !partPath.includes('slides/')) return out
    const layout = this.layoutOf(partPath)
    const lsp = this.findPlaceholder(layout, key)
    if (lsp && layout) out.unshift({ el: lsp, part: layout })
    const master = this.masterOf(partPath)
    const msp = this.findPlaceholder(master, lsp ? (this.phKey(lsp) ?? key) : key, true)
    if (msp) out.unshift({ el: msp, part: master })
    return out
  }

  // ---- text ----------------------------------------------------------------------

  readPPr(pPr: El | null): [PProps, RProps] {
    if (!pPr) return [{}, {}]
    const p: PProps = {}
    const algn = attr(pPr, 'algn')
    if (algn) p.align = algn as Para['align']
    if (attr(pPr, 'marL') !== null) p.marL = this.px(attr(pPr, 'marL'))
    if (attr(pPr, 'indent') !== null) p.indent = this.px(attr(pPr, 'indent'))
    for (const [key, tag] of [['lineSpacing', 'a:lnSpc'], ['spaceBefore', 'a:spcBef'], ['spaceAfter', 'a:spcAft']] as const) {
      const e = child(pPr, tag)
      if (!e) continue
      const pct = child(e, 'a:spcPct')
      const pts = child(e, 'a:spcPts')
      if (pct) p[key] = { pct: num(pct, 'val', 100000) / 100000 }
      else if (pts) p[key] = { px: (num(pts, 'val', 0) / 100) * this.pt }
    }
    if (child(pPr, 'a:buNone')) p.bulletChar = false
    const bu = child(pPr, 'a:buChar')
    if (bu) p.bulletChar = attr(bu, 'char') ?? '•'
    const auto = child(pPr, 'a:buAutoNum')
    if (auto) p.bulletAuto = { type: attr(auto, 'type') ?? 'arabicPeriod', start: num(auto, 'startAt', 1) }
    const buFont = attr(child(pPr, 'a:buFont'), 'typeface')
    if (buFont) p.bulletFont = buFont
    const buClr = readColor(child(pPr, 'a:buClr'), this.th.scheme)
    if (buClr) p.bulletColor = buClr
    const szPct = child(pPr, 'a:buSzPct')
    if (szPct) p.bulletSizePct = num(szPct, 'val', 100000) / 100000
    const szPts = child(pPr, 'a:buSzPts')
    if (szPts) p.bulletSizePx = (num(szPts, 'val', 1800) / 100) * this.pt
    return [p, this.readRPr(child(pPr, 'a:defRPr'))]
  }

  readRPr(rPr: El | null): RProps {
    if (!rPr) return {}
    const r: RProps = {}
    const sz = attr(rPr, 'sz')
    if (sz) r.size = (Number(sz) / 100) * this.pt
    const b = attr(rPr, 'b')
    if (b !== null) r.bold = b === '1' || b === 'true'
    const i = attr(rPr, 'i')
    if (i !== null) r.italic = i === '1' || i === 'true'
    const u = attr(rPr, 'u')
    if (u !== null) r.underline = u !== 'none'
    const strike = attr(rPr, 'strike')
    if (strike !== null) r.strike = strike !== 'noStrike'
    const spc = attr(rPr, 'spc')
    if (spc) r.spacing = (Number(spc) / 100) * this.pt
    const base = attr(rPr, 'baseline')
    if (base) r.baseline = Number(base) / 1000
    if (attr(rPr, 'cap') === 'all') r.caps = true
    const fill = child(rPr, 'a:solidFill') ?? child(child(rPr, 'a:gradFill'), 'a:gsLst/a:gs')
    const color = readColor(fill, this.th.scheme)
    if (color) r.color = color
    const hl = readColor(child(rPr, 'a:highlight'), this.th.scheme)
    if (hl) r.highlight = hl
    const latinEl = child(rPr, 'a:latin')
    this.classify(latinEl)
    const latin = attr(latinEl, 'typeface')
    if (latin) r.latin = latin
    const ea = attr(child(rPr, 'a:ea'), 'typeface')
    if (ea) r.ea = ea
    return r
  }

  levelStyle(lst: El | null, lvl: number): [PProps, RProps] {
    return this.readPPr(child(lst, `a:lvl${lvl + 1}pPr`))
  }

  themeFont(name: string | undefined, fallbackSlot: 'major' | 'minor', script: 'latin' | 'ea'): string | undefined {
    const th = this.th
    if (!name) return th[fallbackSlot][script] || undefined
    const m = name.match(/^\+(mj|mn)-(lt|ea|cs)$/)
    if (!m) return name
    const slot = m[1] === 'mj' ? th.major : th.minor
    return (m[2] === 'lt' ? slot.latin : slot.ea) || undefined
  }

  readText(partPath: string, sp: El, txBody: El, opts: { placeholder?: PlaceholderKey | null; defaults?: TextDefaults; tableStyle?: RProps } = {}): TextBody {
    const master = this.pkg.xml(this.masterOf(partPath))
    const styles = child(master, 'p:txStyles')
    const key = opts.placeholder
    const isTitle = !!key && (key.type === 'title' || key.type === 'ctrTitle')
    const base = key ? (isTitle ? child(styles, 'p:titleStyle') : ['body', 'subTitle', 'obj'].includes(key.type) || key.idx ? child(styles, 'p:bodyStyle') : child(styles, 'p:otherStyle')) : null
    const chain = key ? this.chain(partPath, sp) : [{ el: sp, part: partPath }]
    const fontSlot = opts.defaults?.font ?? (isTitle ? 'major' : 'minor')

    // Body properties: master → layout → slide.
    const body: TextBody = {
      insets: { l: this.px(91440), t: this.px(45720), r: this.px(91440), b: this.px(45720) },
      anchor: 't',
      wrap: true,
      paras: [],
    }
    let fontScale = 1
    let lnReduction = 0
    for (const { el } of chain) {
      const bp = el === sp ? child(txBody, 'a:bodyPr') : lcPath(el, 'txBody/bodyPr')
      if (!bp) continue
      for (const [k, side] of [['lIns', 'l'], ['tIns', 't'], ['rIns', 'r'], ['bIns', 'b']] as const) if (attr(bp, k) !== null) body.insets[side] = this.px(attr(bp, k))
      const anchor = attr(bp, 'anchor')
      if (anchor) body.anchor = anchor === 'just' || anchor === 'dist' ? 'ctr' : (anchor as TextBody['anchor'])
      if (attr(bp, 'anchorCtr') !== null) body.anchorCtr = attr(bp, 'anchorCtr') === '1'
      if (attr(bp, 'wrap')) body.wrap = attr(bp, 'wrap') !== 'none'
      const vert = attr(bp, 'vert')
      if (vert) body.vertical = vert !== 'horz'
      const na = child(bp, 'a:normAutofit')
      if (na) {
        fontScale = num(na, 'fontScale', 100000) / 100000
        lnReduction = num(na, 'lnSpcReduction', 0) / 100000
      }
    }

    const autoCounters = new Map<number, number>()
    for (const p of kids(txBody, 'a:p')) {
      const pPr = child(p, 'a:pPr')
      const lvl = num(pPr, 'lvl', 0)
      let [pp, rp] = this.levelStyle(this.defaultTextStyle, lvl)
      const merge = ([p2, r2]: [PProps, RProps]) => {
        pp = { ...pp, ...p2 }
        rp = { ...rp, ...r2 }
      }
      if (base) merge(this.levelStyle(base, lvl))
      for (const { el } of chain) {
        const lst = el === sp ? child(txBody, 'a:lstStyle') : lcPath(el, 'txBody/lstStyle')
        merge(this.levelStyle(lst, lvl))
      }
      if (opts.tableStyle) rp = { ...rp, ...opts.tableStyle }
      merge(this.readPPr(pPr))
      if (opts.defaults?.color && !rp.color) rp.color = opts.defaults.color

      const runs: Run[] = []
      for (const r of children(p)) {
        if (is(r, 'a:r') || is(r, 'a:fld')) {
          const props = { ...rp, ...this.readRPr(child(r, 'a:rPr')) }
          // Vertical tab is PowerPoint's soft line break.
          let t = text(child(r, 'a:t')).replace(/\u000B/g, '\n')
          if (is(r, 'a:fld') && attr(r, 'type') === 'slidenum') t = String(this.slideNumber)
          const run = this.finishRun(props, t, fontScale, fontSlot)
          const link = attr(child(child(r, 'a:rPr'), 'a:hlinkClick'), 'r:id')
          const href = link ? this.pkg.rels(partPath).target(link) : undefined
          if (href && /^(https?:|mailto:)/.test(href)) run.link = href
          runs.push(run)
        } else if (is(r, 'a:br')) {
          runs.push({ ...this.finishRun({ ...rp, ...this.readRPr(child(r, 'a:rPr')) }, '', fontScale, fontSlot), br: true })
        }
      }
      const empty = !runs.some((r) => r.t.trim())
      if (!runs.length) runs.push(this.finishRun({ ...rp, ...this.readRPr(child(p, 'a:endParaRPr')) }, '', fontScale, fontSlot))

      const lineSpacing = pp.lineSpacing ?? { pct: 1 }
      if (lineSpacing.pct !== undefined && lnReduction) lineSpacing.pct = Math.max(0.5, lineSpacing.pct - lnReduction)
      const para: Para = {
        align: pp.align ?? 'l',
        lineSpacing,
        spaceBefore: pp.spaceBefore,
        spaceAfter: pp.spaceAfter,
        marL: pp.marL ?? 0,
        indent: pp.indent ?? 0,
        runs,
      }
      // Numbered lists count consecutive paragraphs at the same level.
      if (pp.bulletAuto && pp.bulletChar !== false && !empty) {
        const n = (autoCounters.get(lvl) ?? pp.bulletAuto.start - 1) + 1
        autoCounters.set(lvl, n)
        para.bullet = this.bullet(pp, runs[0], autoNumber(pp.bulletAuto.type, n))
      } else {
        if (!pp.bulletAuto) autoCounters.delete(lvl)
        if (pp.bulletChar && !empty) {
          const font = pp.bulletFont ?? ''
          const ch = /wingdings|symbol|webdings/i.test(font) ? (SYMBOL_BULLETS[pp.bulletChar] ?? '•') : pp.bulletChar
          para.bullet = this.bullet(pp, runs[0], ch)
        }
      }
      body.paras.push(para)
    }
    return body
  }

  bullet(pp: PProps, first: Run, textOut: string): Para['bullet'] {
    const size = pp.bulletSizePx ?? first.size * (pp.bulletSizePct ?? 1)
    const font = pp.bulletFont && !/wingdings|symbol|webdings/i.test(pp.bulletFont) ? pp.bulletFont : undefined
    return { text: textOut, color: pp.bulletColor ?? first.color, size, font }
  }

  finishRun(p: RProps, t: string, scale: number, slot: 'major' | 'minor'): Run {
    const latin = this.themeFont(p.latin, slot, 'latin')
    const ea = this.themeFont(p.ea, slot, 'ea')
    const fonts = [latin, ea].filter((f, i, a): f is string => !!f && a.indexOf(f) === i)
    fonts.forEach((f) => this.useFont(f))
    const run: Run = {
      t,
      size: Math.round((p.size ?? 18 * this.pt) * scale * 100) / 100,
      color: p.color ?? this.th.scheme.tx1 ?? '#000000',
    }
    if (fonts.length) run.font = fonts.join(',')
    if (p.bold) run.bold = true
    if (p.italic) run.italic = true
    if (p.underline) run.underline = true
    if (p.strike) run.strike = true
    if (p.spacing) run.spacing = p.spacing
    if (p.baseline) run.baseline = p.baseline
    if (p.caps) run.caps = true
    if (p.highlight) run.highlight = p.highlight
    return run
  }

  // ---- shapes --------------------------------------------------------------------

  /** Maps child coordinates (EMU) of a group into pixels relative to the group box. */
  shapes(partPath: string, container: El, map: CoordMap, opts: { skipPlaceholders?: boolean; groupFill?: Fill | null } = {}): Shape[] {
    const out: Shape[] = []
    for (const el of children(container)) {
      const local = el.localName
      if (!SHAPE_TAGS.has(local)) continue
      if (local === 'AlternateContent') {
        const wrapper = el.ownerDocument!.createElementNS(NS_P, 'p:wrap') as unknown as El
        for (const c of resolveAlternate(el, SUPPORTED_EXT)) wrapper.appendChild(c.cloneNode(true))
        out.push(...this.shapes(partPath, wrapper, map, opts))
        continue
      }
      if (local === 'contentPart') {
        this.warn('Ink drawings are not supported')
        continue
      }
      try {
        const s = this.shape(partPath, el, map, opts)
        if (s) out.push(s)
      } catch (e) {
        this.warn(`Skipped a shape on slide ${this.slideNumber}: ${(e as Error).message}`)
      }
    }
    return out
  }

  xfrm(el: El, chain?: { el: El }[]): { x: number; y: number; cx: number; cy: number; rot: number; flipH: boolean; flipV: boolean; ch?: { x: number; y: number; cx: number; cy: number } } | null {
    const nodes = chain ? [...chain].reverse().map((c) => c.el) : [el]
    for (const n of nodes) {
      const x = lcPath(n, 'spPr/xfrm') ?? lc(n, 'xfrm') ?? lcPath(n, 'grpSpPr/xfrm')
      const off = child(x, 'a:off')
      const ext = child(x, 'a:ext')
      if (!x || !off || !ext) continue
      const chOff = child(x, 'a:chOff')
      const chExt = child(x, 'a:chExt')
      return {
        x: num(off, 'x', 0),
        y: num(off, 'y', 0),
        cx: num(ext, 'cx', 0),
        cy: num(ext, 'cy', 0),
        rot: num(x, 'rot', 0) / 60000,
        flipH: attr(x, 'flipH') === '1',
        flipV: attr(x, 'flipV') === '1',
        ch: chOff && chExt ? { x: num(chOff, 'x', 0), y: num(chOff, 'y', 0), cx: num(chExt, 'cx', 0), cy: num(chExt, 'cy', 0) } : undefined,
      }
    }
    return null
  }

  base(el: El, g: NonNullable<ReturnType<Converter['xfrm']>>, map: CoordMap) {
    const nv = find(el, 'p:cNvPr') ?? findLocal(el, 'cNvPr')
    const [x, y] = map.pt(g.x, g.y)
    const out = {
      id: attr(nv, 'id') ?? '',
      name: attr(nv, 'name') ?? '',
      x,
      y,
      w: map.len(g.cx, 'x'),
      h: map.len(g.cy, 'y'),
    } as Shape
    if (g.rot) out.rot = g.rot
    if (g.flipH) out.flipH = true
    if (g.flipV) out.flipV = true
    return out
  }

  shape(partPath: string, el: El, map: CoordMap, opts: { skipPlaceholders?: boolean; groupFill?: Fill | null }): Shape | null {
    const local = el.localName
    const key = local === 'sp' || local === 'pic' ? this.phKey(el) : null
    if (key && opts.skipPlaceholders) return null
    const nvPr = find(el, 'p:nvPr')
    if (attr(find(el, 'p:cNvPr'), 'hidden') === '1') return null

    if (local === 'grpSp') {
      const g = this.xfrm(el)
      if (!g) return null
      const b = this.base(el, g, map) as GroupNode
      const ch = g.ch ?? { x: g.x, y: g.y, cx: g.cx, cy: g.cy }
      const inner = new CoordMap(this.emu, ch.x, ch.y, ch.cx ? g.cx / ch.cx : 1, ch.cy ? g.cy / ch.cy : 1, map.sx, map.sy)
      const gf = this.readFill(lc(el, 'grpSpPr'), partPath)
      b.kind = 'group'
      b.children = this.shapes(partPath, el, inner, { groupFill: gf === 'group' ? opts.groupFill : (gf ?? opts.groupFill) })
      return b
    }

    const chain = key ? this.chain(partPath, el) : undefined
    const g = this.xfrm(el, chain)
    if (!g) return null
    const b = this.base(el, g, map)

    if (local === 'graphicFrame') return this.graphicFrame(partPath, el, b)

    if (local === 'pic') {
      const video = find(nvPr, 'a:videoFile') ?? find(nvPr, 'a:audioFile')
      const media = find(nvPr, 'p14:media')
      const blip = this.readBlip(lc(el, 'blipFill')!, partPath)
      if (video || media) {
        const src = this.mediaRef(partPath, attr(media, 'r:embed') ?? attr(video, 'r:link'))
        if (src) return { ...b, kind: 'video', src, poster: blip?.src }
      }
      if (!blip) return null
      const spPr = lc(el, 'spPr')
      const prst = attr(child(spPr, 'a:prstGeom'), 'prst')
      const geom = prst ? presetPath(prst, b.w, b.h, readAdjust(child(spPr, 'a:prstGeom'))) : 'rect'
      const stroke = this.readStroke(child(spPr, 'a:ln')) ?? this.styleRefs(lc(el, 'style')).stroke
      return {
        ...b,
        kind: 'image',
        src: blip.src,
        crop: blip.crop,
        opacity: blip.opacity,
        stroke: stroke ? { ...stroke, color: stroke.color || '#000000' } : undefined,
        clip: geom === 'ellipse' ? 'ellipse' : geom && typeof geom === 'object' && 'radius' in geom ? geom : undefined,
      }
    }

    // sp / cxnSp
    const node = b as ShapeNode
    node.kind = 'shape'
    const refs = this.styleRefs(lc(el, 'style'))
    let fill: Fill | null | undefined = refs.fill
    let stroke: Stroke | null | undefined = refs.stroke
    let geomEl: El | null = null
    for (const { el: n } of chain ?? [{ el }]) {
      const spPr = lc(n, 'spPr')
      const f = this.readFill(spPr, partPath)
      if (f !== undefined) fill = f === 'group' ? opts.groupFill : f
      const s = this.readStroke(child(spPr, 'a:ln'))
      if (s !== undefined) stroke = s && !s.color ? (stroke ? { ...s, color: stroke.color } : { ...s, color: this.th.scheme.tx1 }) : s
      geomEl = child(spPr, 'a:prstGeom') ?? child(spPr, 'a:custGeom') ?? geomEl
    }
    if (fill) node.fill = fill
    if (stroke && stroke.color) node.stroke = stroke

    if (geomEl && is(geomEl, 'a:custGeom')) node.geom = { paths: customPath(geomEl, b.w, b.h) }
    else {
      const prst = attr(geomEl, 'prst') ?? 'rect'
      const p = presetPath(prst, b.w, b.h, readAdjust(geomEl))
      if (p === null) {
        this.warn(`Shape "${prst}" is drawn as a rectangle`)
        node.geom = 'rect'
      } else node.geom = Array.isArray(p) ? { paths: p } : p
    }
    if (local === 'cxnSp' && node.geom === 'rect') node.geom = { paths: presetPath('line', b.w, b.h, {}) as never }

    const tx = lc(el, 'txBody')
    if (tx) {
      const body = this.readText(partPath, el, tx, { placeholder: key, defaults: { color: refs.fontColor, font: refs.font } })
      if (body.paras.some((p) => p.runs.some((r) => r.t))) node.text = body
    }
    if (key) node.placeholder = key.type
    const link = attr(find(lc(el, 'nvSpPr'), 'a:hlinkClick'), 'r:id')
    const href = link ? this.pkg.rels(partPath).target(link) : undefined
    if (href && /^https?:/.test(href)) node.link = href
    if (!node.fill && !node.stroke && !node.text) return null
    return node
  }

  graphicFrame(partPath: string, el: El, b: Shape): Shape | null {
    const data = find(el, 'a:graphicData')
    const uri = attr(data, 'uri') ?? ''
    const tbl = child(data, 'a:tbl')
    if (tbl) return this.table(partPath, tbl, b)
    const chartEl = find(data, 'c:chart')
    if (chartEl) {
      const target = this.pkg.rels(partPath).target(attr(chartEl, 'r:id'))
      const chart = target ? readChart(this.pkg, target, this.th.scheme, this.pt, (m) => this.warn(m)) : null
      if (chart) {
        if (chart.font) this.useFont(chart.font)
        return { ...b, kind: 'chart', chart }
      }
      return null
    }
    if (uri.includes('/diagram')) {
      // SmartArt: PowerPoint caches the laid-out shapes in a drawing part.
      const drawingPath = this.pkg.rels(partPath).ofType('/diagramDrawing')
      const drawing = drawingPath ? this.pkg.xml(drawingPath) : null
      const tree = find(drawing, 'dsp:spTree')
      if (!tree || !drawingPath) {
        this.warn('A SmartArt graphic has no cached drawing and was skipped')
        return null
      }
      const gb = b as GroupNode
      gb.kind = 'group'
      gb.children = this.shapes(drawingPath, tree, new CoordMap(this.emu, b.x * this.emu, b.y * this.emu, 1, 1, 1, 1))
      return gb
    }
    // OLE objects and other embeds usually carry a picture preview.
    const pic = find(data, 'p:pic')
    if (pic) {
      const blip = this.readBlip(lc(pic, 'blipFill')!, partPath)
      if (blip) return { ...b, kind: 'image', src: blip.src, crop: blip.crop }
    }
    this.warn(`Embedded object (${uri.split('/').pop()}) was skipped`)
    return null
  }

  table(partPath: string, tbl: El, b: Shape): TableNode {
    const tblPr = child(tbl, 'a:tblPr')
    const flags = {
      firstRow: attr(tblPr, 'firstRow') === '1',
      lastRow: attr(tblPr, 'lastRow') === '1',
      firstCol: attr(tblPr, 'firstCol') === '1',
      lastCol: attr(tblPr, 'lastCol') === '1',
      bandRow: attr(tblPr, 'bandRow') === '1',
      bandCol: attr(tblPr, 'bandCol') === '1',
    }
    const styleId = text(child(tblPr, 'a:tableStyleId'))
    const style = this.tableStyles.get(styleId) ?? null
    if (styleId && !style) this.warn('A table uses a built-in style that the file does not define; it is drawn without it')
    const cols = kids(child(tbl, 'a:tblGrid'), 'a:gridCol').map((c) => this.px(attr(c, 'w')))
    const trs = kids(tbl, 'a:tr')
    const rows = trs.map((tr, ri) => {
      const cells: Cell[] = kids(tr, 'a:tc').map((tc, ci) => {
        // Parts of the table style that apply to this cell, weakest first.
        const parts: El[] = []
        const part = (n: string) => {
          const p = child(style, `a:${n}`)
          if (p) parts.push(p)
        }
        part('wholeTbl')
        if (flags.bandRow) part(ri % 2 === (flags.firstRow ? 1 : 0) ? 'band1H' : 'band2H')
        if (flags.bandCol) part(ci % 2 === (flags.firstCol ? 1 : 0) ? 'band1V' : 'band2V')
        if (flags.lastCol && ci === cols.length - 1) part('lastCol')
        if (flags.firstCol && ci === 0) part('firstCol')
        if (flags.lastRow && ri === trs.length - 1) part('lastRow')
        if (flags.firstRow && ri === 0) part('firstRow')

        let fill: Fill | undefined
        const borders: Cell['borders'] = {}
        const txStyle: RProps = {}
        for (const p of parts) {
          const tcStyle = child(p, 'a:tcStyle')
          const f = this.readFill(child(tcStyle, 'a:fill'), partPath)
          if (f && f !== 'group') fill = f
          const fillRef = child(tcStyle, 'a:fillRef')
          if (fillRef) {
            const c = readColor(fillRef, this.th.scheme)
            if (c) fill = { type: 'solid', color: c }
          }
          const bdr = child(tcStyle, 'a:tcBdr')
          const side = (n: string) => {
            const ln = child(child(bdr, `a:${n}`), 'a:ln')
            const lnRef = child(child(bdr, `a:${n}`), 'a:lnRef')
            if (ln) return this.readStroke(ln)
            if (lnRef) return { w: this.px(12700), color: readColor(lnRef, this.th.scheme) ?? '#000000' }
            return undefined
          }
          const apply = (k: keyof Cell['borders'], s: Stroke | null | undefined) => {
            if (s === null) delete borders[k]
            else if (s) borders[k] = s
          }
          apply('top', side(ri === 0 ? 'top' : 'insideH') ?? (ri === 0 ? undefined : undefined))
          apply('bottom', side(ri === trs.length - 1 ? 'bottom' : 'insideH'))
          apply('left', side(ci === 0 ? 'left' : 'insideV'))
          apply('right', side(ci === cols.length - 1 ? 'right' : 'insideV'))
          const tx = child(p, 'a:tcTxStyle')
          if (tx) {
            if (attr(tx, 'b') === 'on') txStyle.bold = true
            if (attr(tx, 'b') === 'off') txStyle.bold = false
            const c = readColor(tx, this.th.scheme) ?? readColor(child(tx, 'a:fontRef'), this.th.scheme)
            if (c) txStyle.color = c
          }
        }

        const tcPr = child(tc, 'a:tcPr')
        const ownFill = this.readFill(tcPr, partPath)
        if (ownFill === null) fill = undefined
        else if (ownFill && ownFill !== 'group') fill = ownFill
        for (const [k, tag] of [['left', 'a:lnL'], ['right', 'a:lnR'], ['top', 'a:lnT'], ['bottom', 'a:lnB']] as const) {
          const s = this.readStroke(child(tcPr, tag))
          if (s === null) delete borders[k]
          else if (s && s.color) borders[k] = s
        }
        const txBody = child(tc, 'a:txBody')
        const body = txBody ? this.readText(partPath, tc, txBody, { tableStyle: txStyle }) : null
        const cell: Cell = {
          paras: body?.paras ?? [],
          pad: {
            l: this.px(num(tcPr, 'marL', 91440)),
            r: this.px(num(tcPr, 'marR', 91440)),
            t: this.px(num(tcPr, 'marT', 45720)),
            b: this.px(num(tcPr, 'marB', 45720)),
          },
          anchor: (attr(tcPr, 'anchor') as Cell['anchor']) ?? 't',
          borders,
        }
        if (fill) cell.fill = fill
        const span = num(tc, 'gridSpan', 1)
        const rspan = num(tc, 'rowSpan', 1)
        if (span > 1) cell.colSpan = span
        if (rspan > 1) cell.rowSpan = rspan
        if (attr(tc, 'hMerge') === '1' || attr(tc, 'vMerge') === '1') cell.merged = true
        return cell
      })
      return { h: this.px(attr(tr, 'h')), cells }
    })
    return { ...b, kind: 'table', cols, rows }
  }

  // ---- slides --------------------------------------------------------------------

  background(path: string): Fill | null {
    const chain: string[] = []
    for (let p: string | undefined = path; p; p = this.layoutOf(p)) {
      chain.push(p)
      if (p.includes('slideMasters/')) break
    }
    for (const p of chain) {
      const bg = find(this.pkg.xml(p), 'p:bg')
      if (!bg) continue
      const bgPr = child(bg, 'p:bgPr')
      if (bgPr) {
        const f = this.readFill(bgPr, p)
        return f && f !== 'group' ? f : null
      }
      const ref = child(bg, 'p:bgRef')
      if (ref) {
        const idx = num(ref, 'idx', 0)
        const ph = readColor(ref, this.th.scheme) ?? undefined
        const src = idx >= 1001 ? this.th.bgFills[idx - 1001] : this.th.fills[idx - 1]
        const f = src ? this.readFill(wrap(src), p, ph) : null
        return f && f !== 'group' ? f : ph ? { type: 'solid', color: ph } : null
      }
    }
    return { type: 'solid', color: this.th.scheme.bg1 ?? '#FFFFFF' }
  }

  notes(path: string): string {
    const notesPath = this.pkg.rels(path).ofType('/notesSlide')
    const root = notesPath ? this.pkg.xml(notesPath) : null
    for (const sp of findAll(root, 'p:sp')) {
      if (this.phKey(sp)?.type !== 'body') continue
      return kids(lc(sp, 'txBody'), 'a:p')
        .map((p) => findAll(p, 'a:t').map(text).join(''))
        .join('\n')
        .trim()
    }
    return ''
  }

  slide(path: string, index: number): Slide {
    this.slidePath = path
    this.slideNumber = index
    const root = this.pkg.xml(path)!
    const layout = this.layoutOf(path)!
    const master = this.masterOf(path)
    const rootMap = new CoordMap(this.emu, 0, 0, 1, 1, 1, 1)
    const shapes: Shape[] = []
    const layoutRoot = this.pkg.xml(layout)
    const showMaster = attr(layoutRoot, 'showMasterSp') !== '0' && attr(root, 'showMasterSp') !== '0'
    if (showMaster) shapes.push(...this.shapes(master, find(this.pkg.xml(master), 'p:spTree')!, rootMap, { skipPlaceholders: true }))
    shapes.push(...this.shapes(layout, find(layoutRoot, 'p:spTree')!, rootMap, { skipPlaceholders: true }))
    // Layout/master decorations must not collide with the slide's own shape ids.
    for (const s of shapes) s.id = `m${s.id}`
    shapes.push(...this.shapes(path, find(root, 'p:spTree')!, rootMap))

    const transition = find(root, 'p:transition')
    const anyTransition = transition && children(transition).length > 0
    return {
      index,
      hidden: attr(root, 'show') === '0',
      background: this.background(path),
      shapes,
      notes: this.notes(path),
      steps: readAnimations(root, (m) => this.warn(m)),
      transition: anyTransition ? { kind: 'fade', durMs: num(transition, 'p14:dur', 400) } : { kind: 'none', durMs: 0 },
    }
  }

  title(): string {
    const core = this.pkg.xml('docProps/core.xml')
    const t = findAll(core, 'dc:title')[0]
    return t ? text(t) : ''
  }
}

const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main'

/** Wraps a fill element so readFill (which looks at children) can read it. */
function wrap(el: El): El {
  const w = el.ownerDocument!.createElementNS(NS_P, 'p:wrap') as unknown as El
  w.appendChild(el.cloneNode(true))
  return w
}

function findLocal(el: El, local: string): El | null {
  for (const c of children(el)) {
    if (c.localName === local) return c
    const deeper = findLocal(c, local)
    if (deeper) return deeper
  }
  return null
}

/** Maps EMU coordinates inside a (possibly nested, scaled) group to stage pixels. */
class CoordMap {
  private emu: number
  private ox: number
  private oy: number
  /** Accumulated scale (this group relative to the slide). */
  readonly sx: number
  readonly sy: number
  /**
   * @param ox/oy child-space origin of this group (EMU)
   * @param gx/gy scale of this group relative to its parent
   * @param psx/psy accumulated scale of the parent
   */
  constructor(emu: number, ox: number, oy: number, gx: number, gy: number, psx: number, psy: number) {
    this.emu = emu
    this.ox = ox
    this.oy = oy
    this.sx = psx * gx
    this.sy = psy * gy
  }
  pt(x: number, y: number): [number, number] {
    return [Math.round((((x - this.ox) * this.sx) / this.emu) * 100) / 100, Math.round((((y - this.oy) * this.sy) / this.emu) * 100) / 100]
  }
  len(v: number, axis: 'x' | 'y') {
    return Math.round(((v * (axis === 'x' ? this.sx : this.sy)) / this.emu) * 100) / 100
  }
}

function autoNumber(type: string, n: number): string {
  const alpha = (k: number) => {
    let s = ''
    while (k > 0) {
      k--
      s = String.fromCharCode(97 + (k % 26)) + s
      k = Math.floor(k / 26)
    }
    return s
  }
  const roman = (k: number) => {
    const t: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
    let s = ''
    for (const [v, r] of t) while (k >= v) {
      s += r
      k -= v
    }
    return s
  }
  const m = type.match(/^(arabic|alphaLc|alphaUc|romanLc|romanUc|circleNum)(.*)$/)
  if (!m) return `${n}.`
  let core = String(n)
  if (m[1] === 'alphaLc') core = alpha(n)
  if (m[1] === 'alphaUc') core = alpha(n).toUpperCase()
  if (m[1] === 'romanLc') core = roman(n)
  if (m[1] === 'romanUc') core = roman(n).toUpperCase()
  if (m[1] === 'circleNum') return String.fromCharCode(0x2460 + n - 1)
  const suffix = m[2]
  if (suffix.startsWith('ParenBoth')) return `(${core})`
  if (suffix.startsWith('ParenR')) return `${core})`
  if (suffix.startsWith('Plain')) return core
  return `${core}.`
}

function sniffExt(b: Uint8Array) {
  if (b[0] === 0x89 && b[1] === 0x50) return '.png'
  if (b[0] === 0xff && b[1] === 0xd8) return '.jpg'
  if (b[0] === 0x47 && b[1] === 0x49) return '.gif'
  if (b[0] === 0x3c) return '.svg'
  return '.bin'
}

export function convert(bytes: Uint8Array, fallbackTitle: string, onProgress?: (done: number, total: number) => void): ConvertResult {
  const pkg = new Package(bytes)
  const c = new Converter(pkg)
  const pres = pkg.xml('ppt/presentation.xml')!
  const rels: Rels = pkg.rels('ppt/presentation.xml')
  const slides: Slide[] = []
  const ids = kids(child(pres, 'p:sldIdLst'), 'p:sldId')
  ids.forEach((s, i) => {
    const path = rels.target(attr(s, 'r:id'))
    if (path) slides.push(c.slide(path, i + 1))
    onProgress?.(i + 1, ids.length)
  })
  let title = c.title()
  if (!title) {
    const first = slides[0]?.shapes.find((s) => s.kind === 'shape' && (s.placeholder === 'title' || s.placeholder === 'ctrTitle')) as ShapeNode | undefined
    title = first?.text?.paras.map((p) => p.runs.map((r) => r.t).join('')).join(' ').trim() || fallbackTitle
  }
  return {
    deck: { version: 1, title, width: STAGE_W, height: c.height, fonts: c.fonts, fontKinds: c.fontKinds, slides, warnings: [...c.warnings] },
    media: [...c.media.values()],
  }
}
