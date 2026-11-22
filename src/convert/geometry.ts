import type { PathGeom } from '../model'
import { attr, child, children, kids, num, type El } from './xml'

/**
 * Turns DrawingML geometry into SVG paths in the shape's pixel box.
 * Covers the presets that show up in real decks; anything else falls back to a
 * rectangle and is reported as a warning.
 */

type Adj = Record<string, number>

const f = (n: number) => Math.round(n * 100) / 100

function poly(pts: [number, number][], closed = true) {
  return `M${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(' L')}${closed ? ' Z' : ''}`
}

function filled(d: string): PathGeom {
  return [{ d, closed: true, fill: true, stroke: true }]
}

function ellipseD(cx: number, cy: number, rx: number, ry: number) {
  return `M${f(cx - rx)},${f(cy)} A${f(rx)},${f(ry)} 0 1 0 ${f(cx + rx)},${f(cy)} A${f(rx)},${f(ry)} 0 1 0 ${f(cx - rx)},${f(cy)} Z`
}

function roundRectD(w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2)
  return `M${f(r)},0 H${f(w - r)} A${f(r)},${f(r)} 0 0 1 ${f(w)},${f(r)} V${f(h - r)} A${f(r)},${f(r)} 0 0 1 ${f(w - r)},${f(h)} H${f(r)} A${f(r)},${f(r)} 0 0 1 0,${f(h - r)} V${f(r)} A${f(r)},${f(r)} 0 0 1 ${f(r)},0 Z`
}

function star(w: number, h: number, points: number, inner: number) {
  const pts: [number, number][] = []
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points
    const r = i % 2 ? inner : 1
    pts.push([w / 2 + (Math.cos(a) * r * w) / 2, h / 2 + (Math.sin(a) * r * h) / 2])
  }
  return poly(pts)
}

/** Returns null for shapes that render as a plain box ('rect'). */
export function presetPath(prst: string, w: number, h: number, adjIn: Adj): PathGeom | 'rect' | 'ellipse' | { radius: number } | null {
  const ss = Math.min(w, h)
  const adj = (k: string, d: number) => (adjIn[k] ?? d) / 100000
  switch (prst) {
    case 'rect':
    case 'flowChartProcess':
    case 'textNoShape':
    case 'textBox':
      return 'rect'
    case 'ellipse':
    case 'flowChartConnector':
      return 'ellipse'
    case 'roundRect':
    case 'flowChartAlternateProcess':
      return { radius: ss * adj('adj', 16667) }
    case 'flowChartTerminator':
      return { radius: h / 2 }
    case 'triangle':
    case 'flowChartExtract': {
      const x = w * adj('adj', 50000)
      return filled(poly([[x, 0], [w, h], [0, h]]))
    }
    case 'flowChartMerge':
      return filled(poly([[0, 0], [w, 0], [w / 2, h]]))
    case 'rtTriangle':
      return filled(poly([[0, 0], [w, h], [0, h]]))
    case 'diamond':
    case 'flowChartDecision':
      return filled(poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]))
    case 'parallelogram':
    case 'flowChartInputOutput': {
      const o = prst === 'parallelogram' ? ss * adj('adj', 25000) : w / 5
      return filled(poly([[o, 0], [w, 0], [w - o, h], [0, h]]))
    }
    case 'trapezoid': {
      const o = ss * adj('adj', 25000)
      return filled(poly([[o, 0], [w - o, 0], [w, h], [0, h]]))
    }
    case 'homePlate': {
      const x = w - ss * adj('adj', 50000)
      return filled(poly([[0, 0], [x, 0], [w, h / 2], [x, h], [0, h]]))
    }
    case 'chevron': {
      const o = ss * adj('adj', 50000)
      return filled(poly([[0, 0], [w - o, 0], [w, h / 2], [w - o, h], [0, h], [o, h / 2]]))
    }
    case 'pentagon':
      return filled(poly([[w / 2, 0], [w, h * 0.38], [w * 0.81, h], [w * 0.19, h], [0, h * 0.38]]))
    case 'hexagon': {
      const o = ss * adj('adj', 25000)
      return filled(poly([[o, 0], [w - o, 0], [w, h / 2], [w - o, h], [o, h], [0, h / 2]]))
    }
    case 'octagon': {
      const o = ss * adj('adj', 29289)
      return filled(poly([[o, 0], [w - o, 0], [w, o], [w, h - o], [w - o, h], [o, h], [0, h - o], [0, o]]))
    }
    case 'plus':
    case 'mathPlus': {
      const o = ss * adj('adj', 25000)
      return filled(poly([[o, 0], [w - o, 0], [w - o, o], [w, o], [w, h - o], [w - o, h - o], [w - o, h], [o, h], [o, h - o], [0, h - o], [0, o], [o, o]]))
    }
    case 'star4':
      return filled(star(w, h, 4, 0.38))
    case 'star5':
      return filled(star(w, h, 5, 0.38))
    case 'star6':
      return filled(star(w, h, 6, 0.5))
    case 'rightArrow':
    case 'leftArrow': {
      const t = h * adj('adj1', 50000)
      const head = ss * adj('adj2', 50000)
      const y1 = (h - t) / 2
      const y2 = y1 + t
      const pts: [number, number][] = [[0, y1], [w - head, y1], [w - head, 0], [w, h / 2], [w - head, h], [w - head, y2], [0, y2]]
      return filled(poly(prst === 'leftArrow' ? pts.map(([x, y]) => [w - x, y]) : pts))
    }
    case 'upArrow':
    case 'downArrow': {
      const t = w * adj('adj1', 50000)
      const head = ss * adj('adj2', 50000)
      const x1 = (w - t) / 2
      const x2 = x1 + t
      const pts: [number, number][] = [[x1, h], [x1, head], [0, head], [w / 2, 0], [w, head], [x2, head], [x2, h]]
      return filled(poly(prst === 'downArrow' ? pts.map(([x, y]) => [x, h - y]) : pts))
    }
    case 'leftRightArrow': {
      const t = h * adj('adj1', 50000)
      const head = ss * adj('adj2', 50000)
      const y1 = (h - t) / 2
      const y2 = y1 + t
      return filled(poly([[0, h / 2], [head, 0], [head, y1], [w - head, y1], [w - head, 0], [w, h / 2], [w - head, h], [w - head, y2], [head, y2], [head, h]]))
    }
    case 'can':
    case 'flowChartMagneticDisk': {
      const ry = (ss * adj('adj', 25000)) / 2
      return [
        { d: `M0,${f(ry)} A${f(w / 2)},${f(ry)} 0 0 0 ${f(w)},${f(ry)} V${f(h - ry)} A${f(w / 2)},${f(ry)} 0 0 1 0,${f(h - ry)} Z`, closed: true, fill: true, stroke: true },
        { d: ellipseD(w / 2, ry, w / 2, ry), closed: true, fill: true, stroke: true },
      ]
    }
    case 'donut': {
      const t = ss * adj('adj', 25000)
      return [{ d: ellipseD(w / 2, h / 2, w / 2, h / 2) + ' ' + ellipseD(w / 2, h / 2, w / 2 - t, h / 2 - t), closed: true, fill: true, stroke: true }]
    }
    case 'snip1Rect': {
      const o = ss * adj('adj', 16667)
      return filled(poly([[0, 0], [w - o, 0], [w, o], [w, h], [0, h]]))
    }
    case 'snip2SameRect': {
      const o = ss * adj('adj1', 16667)
      return filled(poly([[o, 0], [w - o, 0], [w, o], [w, h], [0, h], [0, o]]))
    }
    case 'round1Rect': {
      const r = ss * adj('adj', 16667)
      return filled(`M0,0 H${f(w - r)} A${f(r)},${f(r)} 0 0 1 ${f(w)},${f(r)} V${f(h)} H0 Z`)
    }
    case 'round2SameRect': {
      const r = ss * adj('adj1', 16667)
      return filled(`M${f(r)},0 H${f(w - r)} A${f(r)},${f(r)} 0 0 1 ${f(w)},${f(r)} V${f(h)} H0 V${f(r)} A${f(r)},${f(r)} 0 0 1 ${f(r)},0 Z`)
    }
    case 'frame': {
      const t = ss * adj('adj1', 12500)
      return [{ d: `M0,0 H${f(w)} V${f(h)} H0 Z M${f(t)},${f(t)} V${f(h - t)} H${f(w - t)} V${f(t)} Z`, closed: true, fill: true, stroke: true }]
    }
    case 'wedgeRectCallout':
    case 'wedgeRoundRectCallout':
    case 'wedgeEllipseCallout': {
      const px = w / 2 + w * adj('adj1', -20833)
      const py = h / 2 + h * adj('adj2', 62500)
      const base = prst === 'wedgeEllipseCallout' ? ellipseD(w / 2, h / 2, w / 2, h / 2) : prst === 'wedgeRoundRectCallout' ? roundRectD(w, h, ss * 0.16667) : poly([[0, 0], [w, 0], [w, h], [0, h]])
      const bx = Math.min(Math.max(px, w * 0.15), w * 0.85)
      const tip = py > h ? poly([[bx - w * 0.08, h - 1], [px, py], [bx + w * 0.08, h - 1]]) : py < 0 ? poly([[bx - w * 0.08, 1], [px, py], [bx + w * 0.08, 1]]) : ''
      return [{ d: `${base} ${tip}`, closed: true, fill: true, stroke: true }]
    }
    case 'cloud':
    case 'cloudCallout':
    case 'flowChartOnlineStorage':
    case 'smileyFace':
    case 'heart':
      return 'ellipse'
    case 'rightBrace':
    case 'leftBrace': {
      const r = Math.min(w, h * adj('adj1', 8333))
      const my = h * adj('adj2', 50000)
      const x0 = 0
      const x1 = w / 2
      const d = `M${x0},0 Q${x1},0 ${x1},${f(r)} V${f(my - r)} Q${x1},${f(my)} ${f(w)},${f(my)} Q${x1},${f(my)} ${x1},${f(my + r)} V${f(h - r)} Q${x1},${f(h)} ${x0},${f(h)}`
      const out: PathGeom = [{ d, closed: false, fill: false, stroke: true }]
      return prst === 'leftBrace' ? out.map((p) => ({ ...p, d: mirrorX(p.d, w) })) : out
    }
    case 'rightBracket':
    case 'leftBracket': {
      const r = Math.min(w, h * adj('adj', 8333))
      const d = `M0,0 Q${f(w)},0 ${f(w)},${f(r)} V${f(h - r)} Q${f(w)},${f(h)} 0,${f(h)}`
      const out: PathGeom = [{ d, closed: false, fill: false, stroke: true }]
      return prst === 'leftBracket' ? out.map((p) => ({ ...p, d: mirrorX(p.d, w) })) : out
    }
    case 'arc': {
      const a1 = (adjIn.adj1 ?? 16200000) / 60000
      const a2 = (adjIn.adj2 ?? 0) / 60000
      const pt = (a: number) => [w / 2 + (w / 2) * Math.cos((a * Math.PI) / 180), h / 2 + (h / 2) * Math.sin((a * Math.PI) / 180)]
      const [sx, sy] = pt(a1)
      const [ex, ey] = pt(a2)
      const sweep = (((a2 - a1) % 360) + 360) % 360
      return [{ d: `M${f(sx)},${f(sy)} A${f(w / 2)},${f(h / 2)} 0 ${sweep > 180 ? 1 : 0} 1 ${f(ex)},${f(ey)}`, closed: false, fill: false, stroke: true }]
    }
    case 'line':
    case 'straightConnector1':
      return [{ d: `M0,0 L${f(w)},${f(h)}`, closed: false, fill: false, stroke: true }]
    case 'bentConnector2':
      return [{ d: `M0,0 H${f(w)} V${f(h)}`, closed: false, fill: false, stroke: true }]
    case 'bentConnector3': {
      const x = w * adj('adj1', 50000)
      return [{ d: `M0,0 H${f(x)} V${f(h)} H${f(w)}`, closed: false, fill: false, stroke: true }]
    }
    case 'bentConnector4': {
      const x = w * adj('adj1', 50000)
      const y = h * adj('adj2', 50000)
      return [{ d: `M0,0 H${f(x)} V${f(y)} H${f(w)} V${f(h)}`, closed: false, fill: false, stroke: true }]
    }
    case 'curvedConnector2':
      return [{ d: `M0,0 C${f(w / 2)},0 ${f(w)},${f(h / 2)} ${f(w)},${f(h)}`, closed: false, fill: false, stroke: true }]
    case 'curvedConnector3':
    case 'curvedConnector4':
    case 'curvedConnector5': {
      const x = w * adj('adj1', 50000)
      return [{ d: `M0,0 C${f(x)},0 ${f(x)},${f(h)} ${f(w)},${f(h)}`, closed: false, fill: false, stroke: true }]
    }
    default:
      return null
  }
}

function mirrorX(d: string, w: number) {
  // Mirrors absolute x coordinates in the simple paths built above.
  return d.replace(/([MLQHVCA ])(-?[\d.]+),(-?[\d.]+)/g, (_m, c, x, y) => `${c}${f(w - Number(x))},${y}`).replace(/H(-?[\d.]+)/g, (_m, x) => `H${f(w - Number(x))}`)
}

/** Reads <a:avLst> guide values into a name → value map. */
export function readAdjust(prstGeom: El | null): Adj {
  const out: Adj = {}
  for (const gd of kids(child(prstGeom, 'a:avLst'), 'a:gd')) {
    const m = (attr(gd, 'fmla') ?? '').match(/^val\s+(-?\d+)/)
    if (m) out[attr(gd, 'name') ?? 'adj'] = Number(m[1])
  }
  return out
}

/** Converts <a:custGeom> into SVG paths scaled to w×h. */
export function customPath(custGeom: El, w: number, h: number): PathGeom {
  const out: PathGeom = []
  for (const path of kids(child(custGeom, 'a:pathLst'), 'a:path')) {
    const pw = num(path, 'w', 0) || w
    const ph = num(path, 'h', 0) || h
    const sx = pw ? w / pw : 1
    const sy = ph ? h / ph : 1
    const pt = (el: El | null) => [num(el, 'x', 0) * sx, num(el, 'y', 0) * sy] as [number, number]
    let d = ''
    let cur: [number, number] = [0, 0]
    let closed = false
    for (const cmd of children(path)) {
      const pts = kids(cmd, 'a:pt')
      switch (cmd.localName) {
        case 'moveTo':
          cur = pt(pts[0])
          d += `M${f(cur[0])},${f(cur[1])} `
          break
        case 'lnTo':
          cur = pt(pts[0])
          d += `L${f(cur[0])},${f(cur[1])} `
          break
        case 'cubicBezTo': {
          const [a, b, c] = pts.map(pt)
          d += `C${f(a[0])},${f(a[1])} ${f(b[0])},${f(b[1])} ${f(c[0])},${f(c[1])} `
          cur = c
          break
        }
        case 'quadBezTo': {
          const [a, b] = pts.map(pt)
          d += `Q${f(a[0])},${f(a[1])} ${f(b[0])},${f(b[1])} `
          cur = b
          break
        }
        case 'arcTo': {
          const wr = num(cmd, 'wR', 0) * sx
          const hr = num(cmd, 'hR', 0) * sy
          const st = (num(cmd, 'stAng', 0) / 60000) * (Math.PI / 180)
          const sw = (num(cmd, 'swAng', 0) / 60000) * (Math.PI / 180)
          // Centre of the ellipse the arc starts on, then its end point.
          const cx = cur[0] - wr * Math.cos(st)
          const cy = cur[1] - hr * Math.sin(st)
          const ex = cx + wr * Math.cos(st + sw)
          const ey = cy + hr * Math.sin(st + sw)
          d += `A${f(wr)},${f(hr)} 0 ${Math.abs(sw) > Math.PI ? 1 : 0} ${sw > 0 ? 1 : 0} ${f(ex)},${f(ey)} `
          cur = [ex, ey]
          break
        }
        case 'close':
          d += 'Z '
          closed = true
          break
      }
    }
    out.push({ d: d.trim(), closed, fill: attr(path, 'fill') !== 'none', stroke: attr(path, 'stroke') !== '0' && attr(path, 'stroke') !== 'false' })
  }
  return out
}
