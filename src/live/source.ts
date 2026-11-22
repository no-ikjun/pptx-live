import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * A CSV data source for live slides: a Google Sheet polled every few seconds,
 * a CSV file the presenter drops onto the page, or sample data for rehearsal.
 * The last good copy is kept in localStorage so a reload or a dropped Wi-Fi
 * connection does not blank the results.
 */

export type SourceKind = 'sheet' | 'upload' | 'sample'

export type CsvSourceOptions = {
  /** Unique key for localStorage, e.g. the deck name. */
  storageKey: string
  /** Google Sheet id (the part between /d/ and /edit). The sheet must be viewable by anyone with the link. */
  sheetId?: string
  /** Optional tab name inside the sheet. */
  sheetTab?: string
  pollMs?: number
  /** Fake CSV for rehearsals. */
  sample?: () => string
}

type Stored = { source: SourceKind; sheetId: string; since: string | null; csv: string | null; csvName: string | null }

export function sheetCsvUrl(sheetId: string, tab?: string) {
  const sheet = tab ? `&sheet=${encodeURIComponent(tab)}` : ''
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv${sheet}&_=${Date.now()}`
}

/** Accepts a full Google Sheets URL or a bare id. */
export function sheetIdFrom(input: string) {
  return input.trim().replace(/.*\/d\/([^/?#]+).*/, '$1')
}

export function useCsvSource(opts: CsvSourceOptions) {
  const key = `pptx-live:${opts.storageKey}`
  const [stored, setStored] = useState<Stored>(() => {
    const fallback: Stored = { source: opts.sheetId ? 'sheet' : 'upload', sheetId: opts.sheetId ?? '', since: null, csv: null, csvName: null }
    try {
      const raw = localStorage.getItem(key)
      return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
    } catch {
      return fallback
    }
  })
  const [fresh, setFresh] = useState<string | null>(null)
  const [status, setStatus] = useState<{ ok: boolean; at: Date | null; error?: string }>({ ok: false, at: null })

  const update = useCallback(
    (patch: Partial<Stored>) =>
      setStored((s) => {
        const next = { ...s, ...patch }
        try {
          localStorage.setItem(key, JSON.stringify(next))
        } catch {
          // Storage can be unavailable (private windows); the session still works.
        }
        return next
      }),
    [key],
  )

  const refresh = useCallback(async () => {
    if (!stored.sheetId) return
    try {
      const res = await fetch(sheetCsvUrl(stored.sheetId, opts.sheetTab), { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      if (text.trimStart().startsWith('<')) throw new Error('the sheet is not shared with "anyone with the link"')
      setFresh(text)
      update({ csv: text, csvName: null })
      setStatus({ ok: true, at: new Date() })
    } catch (e) {
      setStatus((s) => ({ ok: false, at: s.at, error: e instanceof Error ? e.message : String(e) }))
    }
  }, [stored.sheetId, opts.sheetTab, update])

  useEffect(() => {
    if (stored.source !== 'sheet' || !stored.sheetId) return
    refresh()
    const id = window.setInterval(refresh, opts.pollMs ?? 5000)
    return () => window.clearInterval(id)
  }, [stored.source, stored.sheetId, refresh, opts.pollMs])

  // Drop a CSV file anywhere on the page to use it.
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    const drop = async (e: DragEvent) => {
      const file = e.dataTransfer?.files[0]
      if (!file) return
      e.preventDefault()
      update({ source: 'upload', csv: await file.text(), csvName: file.name })
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [update])

  const sample = opts.sample
  const csv = useMemo(
    () => (stored.source === 'sample' ? (sample?.() ?? null) : stored.source === 'sheet' ? (fresh ?? stored.csv) : stored.csv),
    [stored.source, stored.csv, fresh, sample],
  )

  return {
    csv,
    source: stored.source,
    sheetId: stored.sheetId,
    csvName: stored.csvName,
    /** ISO time; rows stamped earlier can be filtered out (test submissions). */
    since: stored.since,
    status,
    hasSample: !!opts.sample,
    refresh,
    selectSheet: (input?: string) => update({ source: 'sheet', sheetId: input ? sheetIdFrom(input) : stored.sheetId }),
    selectUpload: (text: string, name: string) => update({ source: 'upload', csv: text, csvName: name }),
    selectSample: () => update({ source: 'sample' }),
    setSince: (since: string | null) => update({ since }),
  }
}

export type CsvSource = ReturnType<typeof useCsvSource>
