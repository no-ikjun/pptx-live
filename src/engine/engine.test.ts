import { DOMParser } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'
import { readColor } from '../convert/color'
import { customPath, presetPath } from '../convert/geometry'
import type { Step } from '../model'
import { animState, freshClock, nextClickStep } from './builds'
import { formatNumber } from './Chart'
import { fontStack, splitWeight, webFontFor } from './fonts'

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const xml = (s: string) => new DOMParser().parseFromString(`<root xmlns:a="${A}">${s}</root>`, 'application/xml').documentElement as unknown as Element

describe('colors', () => {
  it('resolves scheme colours with luminance transforms', () => {
    const el = xml('<a:schemeClr val="accent1"><a:lumMod val="50000"/></a:schemeClr>')
    expect(readColor(el, { accent1: '#4472C4' })).toBe('#203864')
  })
  it('keeps alpha as an 8-digit hex', () => {
    expect(readColor(xml('<a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr>'), {})).toBe('#FF000080')
  })
})

describe('geometry', () => {
  it('maps simple presets to boxes', () => {
    expect(presetPath('rect', 100, 50, {})).toBe('rect')
    expect(presetPath('ellipse', 100, 50, {})).toBe('ellipse')
    expect(presetPath('roundRect', 100, 50, {})).toEqual({ radius: 50 * 0.16667 })
  })
  it('returns null for unknown presets so the converter can warn', () => {
    expect(presetPath('gear9', 10, 10, {})).toBeNull()
  })
  it('scales custom paths to the shape box', () => {
    // The root element stands in for <a:custGeom>.
    const custGeom = xml('<a:pathLst><a:path w="10" h="10"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="10" y="10"/></a:lnTo><a:close/></a:path></a:pathLst>')
    expect(customPath(custGeom, 200, 100)[0].d).toBe('M0,0 L200,100 Z')
  })
})

describe('number formats', () => {
  it('handles literals, decimals, grouping and percent', () => {
    expect(formatNumber(49, '0"분"')).toBe('49분')
    expect(formatNumber(1234.5, '#,##0.0')).toBe('1,234.5')
    expect(formatNumber(0.256, '0%')).toBe('26%')
    expect(formatNumber(3, undefined)).toBe('3')
  })
})

describe('fonts', () => {
  it('splits weight suffixes', () => {
    expect(splitWeight('SUITE ExtraBold')).toEqual({ base: 'SUITE', weight: 800 })
    expect(splitWeight('Arial-BoldMT')).toEqual({ base: 'Arial', weight: 700 })
  })
  it('maps Office fonts to metric-compatible web fonts', () => {
    expect(webFontFor('Calibri')?.family).toBe('Carlito')
    expect(fontStack('Calibri,맑은 고딕', true).family).toContain("'Carlito'")
    expect(fontStack('Calibri', true).weight).toBe(700)
  })
})

describe('builds', () => {
  const steps: Step[] = [
    { auto: false, effects: [{ target: 'a', cls: 'entr', kind: 'fade', delay: 0, dur: 500 }] },
    { auto: true, effects: [{ target: 'b', cls: 'entr', kind: 'appear', delay: 0, dur: 0 }] },
  ]
  it('hides entrance targets until their click', () => {
    const clock = freshClock(0)
    const { anim } = animState(steps, clock, 1000)
    expect(anim.get('a')).toBe('hidden')
    expect(anim.get('b')).toBe('hidden')
    expect(nextClickStep(steps, clock)).toBe(0)
  })
  it('plays a click step and chains the automatic step after it', () => {
    const clock = { ...freshClock(0), clicks: [1000] }
    expect(animState(steps, clock, 1250).anim.get('a')).toMatchObject({ opacity: expect.any(Number) })
    const done = animState(steps, clock, 1600)
    expect(done.anim.has('a')).toBe(false)
    expect(done.anim.has('b')).toBe(false)
    expect(nextClickStep(steps, clock)).toBeNull()
  })
})
