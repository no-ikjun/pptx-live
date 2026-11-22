import { attr, children, is, num, type El } from './xml'

/** Theme colour scheme after applying the master's clrMap (bg1→lt1, tx1→dk1, …). */
export type Scheme = Record<string, string>

const PRESET: Record<string, string> = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00',
  gray: '808080', grey: '808080', silver: 'C0C0C0', orange: 'FFA500', purple: '800080', navy: '000080',
  darkGray: 'A9A9A9', lightGray: 'D3D3D3', darkBlue: '00008B', darkRed: '8B0000', darkGreen: '006400',
}

type RGB = [number, number, number]

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex([r, g, b]: RGB) {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
  return (c(r) + c(g) + c(b)).toUpperCase()
}

function rgbToHsl([r, g, b]: RGB): RGB {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h / 6, s, l]
}

function hslToRgb([h, s, l]: RGB): RGB {
  if (s === 0) return [l * 255, l * 255, l * 255]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255]
}

/** Applies DrawingML colour transforms (lumMod, lumOff, tint, shade, satMod, alpha). */
function transform(hex: string, mods: El[]): string {
  let rgb = hexToRgb(hex)
  let alpha = 1
  for (const m of mods) {
    const v = num(m, 'val', 100000) / 100000
    switch (m.localName) {
      case 'lumMod': {
        const hsl = rgbToHsl(rgb)
        hsl[2] *= v
        rgb = hslToRgb(hsl)
        break
      }
      case 'lumOff': {
        const hsl = rgbToHsl(rgb)
        hsl[2] = Math.min(1, Math.max(0, hsl[2] + v))
        rgb = hslToRgb(hsl)
        break
      }
      case 'satMod': {
        const hsl = rgbToHsl(rgb)
        hsl[1] = Math.min(1, hsl[1] * v)
        rgb = hslToRgb(hsl)
        break
      }
      case 'tint':
        rgb = rgb.map((c) => 255 - (255 - c) * v) as RGB
        break
      case 'shade':
        rgb = rgb.map((c) => c * v) as RGB
        break
      case 'alpha':
        alpha = v
        break
      case 'alphaMod':
        alpha *= v
        break
    }
  }
  const out = '#' + rgbToHex(rgb)
  return alpha < 1 ? out + Math.round(alpha * 255).toString(16).padStart(2, '0').toUpperCase() : out
}

/**
 * Reads a colour from an element that contains one colour child
 * (srgbClr, schemeClr, sysClr, prstClr, scrgbClr). `phClr` resolves to
 * `placeholder` (the colour a style reference passes in).
 */
export function readColor(container: El | null | undefined, scheme: Scheme, placeholder?: string): string | null {
  if (!container) return null
  for (const c of children(container)) {
    let hex: string | null = null
    if (is(c, 'a:srgbClr')) hex = attr(c, 'val')
    else if (is(c, 'a:sysClr')) hex = attr(c, 'lastClr') ?? (attr(c, 'val') === 'window' ? 'FFFFFF' : '000000')
    else if (is(c, 'a:prstClr')) hex = PRESET[attr(c, 'val') ?? ''] ?? '000000'
    else if (is(c, 'a:scrgbClr')) {
      const lin = (k: string) => {
        const v = num(c, k, 0) / 100000
        return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
      }
      hex = rgbToHex([lin('r') * 255, lin('g') * 255, lin('b') * 255])
    } else if (is(c, 'a:schemeClr')) {
      const key = attr(c, 'val') ?? ''
      const base = key === 'phClr' ? placeholder : scheme[key]
      hex = base ? base.replace('#', '').slice(0, 6) : '000000'
    } else continue
    return transform(hex ?? '000000', children(c))
  }
  return null
}
