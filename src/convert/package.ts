import { DOMParser } from '@xmldom/xmldom'
import { unzipSync } from 'fflate'
import { attr, kids, type El } from './xml'

/** A PPTX file opened in memory, with parsed XML parts and relationships. */
export class Package {
  private files: Record<string, Uint8Array>
  private xmlCache = new Map<string, El>()
  private relCache = new Map<string, Rels>()

  constructor(bytes: Uint8Array) {
    this.files = unzipSync(bytes)
  }

  has(path: string) {
    return path in this.files
  }

  bytes(path: string): Uint8Array | undefined {
    return this.files[path]
  }

  xml(path: string): El | null {
    if (this.xmlCache.has(path)) return this.xmlCache.get(path)!
    const data = this.files[path]
    if (!data) return null
    const doc = new DOMParser().parseFromString(new TextDecoder().decode(data), 'application/xml')
    const root = doc.documentElement as unknown as El
    this.xmlCache.set(path, root)
    return root
  }

  rels(path: string): Rels {
    if (this.relCache.has(path)) return this.relCache.get(path)!
    const dir = path.slice(0, path.lastIndexOf('/'))
    const file = path.slice(path.lastIndexOf('/') + 1)
    const root = this.xml(`${dir}/_rels/${file}.rels`)
    const rels = new Rels()
    for (const r of kids(root, 'rel:Relationship')) {
      const target = attr(r, 'Target') ?? ''
      const external = attr(r, 'TargetMode') === 'External'
      rels.add(attr(r, 'Id') ?? '', attr(r, 'Type') ?? '', external ? target : resolvePath(dir, target), external)
    }
    this.relCache.set(path, rels)
    return rels
  }
}

export class Rels {
  private byId = new Map<string, { type: string; target: string; external: boolean }>()
  add(id: string, type: string, target: string, external: boolean) {
    this.byId.set(id, { type, target, external })
  }
  target(id: string | null | undefined) {
    return id ? this.byId.get(id)?.target : undefined
  }
  get(id: string | null | undefined) {
    return id ? this.byId.get(id) : undefined
  }
  ofType(suffix: string) {
    for (const r of this.byId.values()) if (r.type.endsWith(suffix)) return r.target
    return undefined
  }
  allOfType(suffix: string) {
    return [...this.byId.values()].filter((r) => r.type.endsWith(suffix)).map((r) => r.target)
  }
}

export function resolvePath(dir: string, target: string) {
  if (target.startsWith('/')) return target.slice(1)
  const parts = dir.split('/').filter(Boolean)
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}
