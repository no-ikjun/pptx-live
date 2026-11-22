/** Small namespace-aware helpers over DOM Elements (xmldom in Node, DOMParser in browsers). */

export const NS: Record<string, string> = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  c: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  p14: 'http://schemas.microsoft.com/office/powerpoint/2010/main',
  a14: 'http://schemas.microsoft.com/office/drawing/2010/main',
  asvg: 'http://schemas.microsoft.com/office/drawing/2016/SVG/main',
  dgm: 'http://schemas.openxmlformats.org/drawingml/2006/diagram',
  dsp: 'http://schemas.microsoft.com/office/drawing/2008/diagram',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  dc: 'http://purl.org/dc/elements/1.1/',
}

export type El = Element

function split(q: string): [string, string] {
  const i = q.indexOf(':')
  return [NS[q.slice(0, i)], q.slice(i + 1)]
}

export function is(el: Node | null | undefined, q: string): el is El {
  if (!el || el.nodeType !== 1) return false
  const [ns, local] = split(q)
  return (el as El).namespaceURI === ns && (el as El).localName === local
}

export function children(el: El | null | undefined): El[] {
  const out: El[] = []
  if (!el) return out
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n as El)
  return out
}

/** Direct child (or a path of direct children, "a:b/a:c"). */
export function child(el: El | null | undefined, path: string): El | null {
  let cur: El | null | undefined = el
  for (const q of path.split('/')) {
    if (!cur) return null
    cur = children(cur).find((c) => is(c, q)) ?? null
  }
  return cur ?? null
}

export function kids(el: El | null | undefined, q: string): El[] {
  return children(el).filter((c) => is(c, q))
}

/** First descendant matching q (depth-first). */
export function find(el: El | null | undefined, q: string): El | null {
  if (!el) return null
  const [ns, local] = split(q)
  const list = el.getElementsByTagNameNS(ns, local)
  return list.length ? (list[0] as El) : null
}

export function findAll(el: El | null | undefined, q: string): El[] {
  if (!el) return []
  const [ns, local] = split(q)
  return Array.from(el.getElementsByTagNameNS(ns, local) as unknown as ArrayLike<El>)
}

export function attr(el: El | null | undefined, name: string): string | null {
  if (!el) return null
  if (name.includes(':')) {
    const [ns, local] = split(name)
    return el.hasAttributeNS(ns, local) ? el.getAttributeNS(ns, local) : null
  }
  return el.hasAttribute(name) ? el.getAttribute(name) : null
}

export function num(el: El | null | undefined, name: string, fallback: number): number
export function num(el: El | null | undefined, name: string): number | null
export function num(el: El | null | undefined, name: string, fallback?: number): number | null {
  const v = attr(el, name)
  if (v === null || v === '') return fallback ?? null
  const n = Number(v)
  return Number.isFinite(n) ? n : (fallback ?? null)
}

export function text(el: El | null | undefined): string {
  return el?.textContent ?? ''
}

/**
 * Resolves mc:AlternateContent by picking the branch we can render: the
 * Fallback when the Choice needs an extension we do not support (e.g. Office
 * math), otherwise the Choice.
 */
export function resolveAlternate(el: El, supported: Set<string>): El[] {
  const choice = child(el, 'mc:Choice')
  const fallback = child(el, 'mc:Fallback')
  const requires = (attr(choice, 'Requires') ?? '').split(/\s+/).filter(Boolean)
  const ok = choice && requires.every((r) => supported.has(r))
  return children(ok ? choice : (fallback ?? choice))
}
