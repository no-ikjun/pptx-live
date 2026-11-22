import Papa from 'papaparse'
import { PARTS, QUESTIONS, type Part } from './answerKey'

export type Condition = 'ai' | 'helper' | 'self'
export const CONDITIONS: Condition[] = ['ai', 'helper', 'self']
export const CONDITION_LABEL: Record<Condition, string> = { ai: 'AI', helper: '학습 도우미', self: '독학' }

export type Response = {
  /** Row number in the sheet (2 = first response), used only for de-duplication and debugging. */
  row: number
  timestamp: Date | null
  condition: Condition
  /** Points per part id (0 or 1). */
  parts: Record<string, 0 | 1>
  /** Parts left blank. */
  blanks: string[]
  score: number
  difficulty: number | null
}

export type ParseResult = {
  responses: Response[]
  /** Rows skipped because the condition could not be read. */
  skipped: number
  /** Form columns that the answer key expects but the CSV lacks. */
  missingColumns: string[]
}

/** "7번 (1) (숫자만 쓰시오)" → "7번 (1)"; "이번 시험의 난이도는…" stays as is. */
function normalizeHeader(h: string) {
  const m = h.trim().match(/^(\d+)\s*번(?:\s*\((\d)\))?/)
  if (!m) return h.trim()
  return m[2] ? `${m[1]}번 (${m[2]})` : `${m[1]}번`
}

function readCondition(v: string): Condition | null {
  const s = v.replace(/\s/g, '')
  if (!s) return null
  if (s.includes('도우미') || s.includes('질문')) return 'helper'
  if (s.includes('독학') || s.includes('혼자')) return 'self'
  if (/ai/i.test(s)) return 'ai'
  return null
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨'

function readChoice(v: string): number | null {
  const s = v.trim()
  const c = CIRCLED.indexOf(s[0])
  if (c >= 0) return c + 1
  const m = s.match(/\d+/)
  return m ? Number(m[0]) : null
}

/**
 * Reads an amount in 만 원. Accepts "16", "16만", "16만 원", "160,000", "160000원", "0원".
 * A plain number of 10,000 or more is taken as 원 and converted.
 */
export function readAmount(v: string): number | null {
  const s = v.replace(/[,\s]/g, '')
  if (!s) return null
  const m = s.match(/-?\d+(?:\.\d+)?/)
  if (!m) return /없/.test(s) ? 0 : null
  const n = Number(m[0])
  if (s.includes('만')) return n
  if (s.endsWith('원') && n >= 10000) return n / 10000
  if (n >= 10000) return n / 10000
  return n
}

function readYesNo(v: string): '예' | '아니오' | null {
  const s = v.replace(/\s/g, '')
  if (!s) return null
  if (/아니|않|안뺀|안빼|no|x|빼지/i.test(s)) return '아니오'
  if (/예|네|뺀다|뺌|yes|o/i.test(s)) return '예'
  return null
}

function gradePart(part: Part, raw: string): 0 | 1 {
  if (part.kind === 'choice') return readChoice(raw) === part.answer ? 1 : 0
  if (part.kind === 'yesno') return readYesNo(raw) === part.answer ? 1 : 0
  const n = readAmount(raw)
  return n !== null && Math.abs(n - (part.answer as number)) < 1e-9 ? 1 : 0
}

/** Parses "2026. 11. 22 오후 9:31:14" (Google Forms, ko-KR) or ISO-ish strings. */
export function parseTimestamp(v: string): Date | null {
  const m = v.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s*(오전|오후)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (m) {
    let hour = Number(m[5])
    if (m[4] === '오후' && hour < 12) hour += 12
    if (m[4] === '오전' && hour === 12) hour = 0
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, Number(m[6]), Number(m[7] ?? 0))
  }
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export function parseCsv(text: string): ParseResult {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: true })
  const [header, ...rows] = parsed.data
  if (!header) return { responses: [], skipped: 0, missingColumns: PARTS.map((p) => p.id) }
  const cols = header.map(normalizeHeader)
  const idx = (pred: (h: string) => boolean) => cols.findIndex(pred)
  const tsCol = idx((h) => h.includes('타임스탬프') || /timestamp/i.test(h))
  const condCol = idx((h) => h.includes('조는') || h.includes('속한') || h.includes('조건'))
  const diffCol = idx((h) => h.includes('난이도'))
  const partCol = Object.fromEntries(PARTS.map((p) => [p.id, cols.indexOf(p.id)]))
  const missingColumns = PARTS.filter((p) => partCol[p.id] < 0).map((p) => p.id)

  const responses: Response[] = []
  let skipped = 0
  rows.forEach((r, i) => {
    const condition = condCol >= 0 ? readCondition(r[condCol] ?? '') : null
    if (!condition) {
      skipped++
      return
    }
    const parts: Record<string, 0 | 1> = {}
    const blanks: string[] = []
    for (const p of PARTS) {
      const raw = partCol[p.id] >= 0 ? (r[partCol[p.id]] ?? '') : ''
      if (!raw.trim()) blanks.push(p.id)
      parts[p.id] = gradePart(p, raw)
    }
    const diff = diffCol >= 0 ? Number((r[diffCol] ?? '').match(/\d+/)?.[0]) : NaN
    responses.push({
      row: i + 2,
      timestamp: tsCol >= 0 ? parseTimestamp(r[tsCol] ?? '') : null,
      condition,
      parts,
      blanks,
      score: Object.values(parts).reduce<number>((a, b) => a + b, 0),
      difficulty: Number.isFinite(diff) ? diff : null,
    })
  })
  return { responses, skipped, missingColumns }
}

// ---- statistics --------------------------------------------------------------

export type Rate = { correct: number; total: number }

/** Full credit on a question = every part of it correct. */
export function questionCorrect(r: Response, q: number) {
  return PARTS.filter((p) => p.question === q).every((p) => r.parts[p.id] === 1)
}

export function rate(responses: Response[], ok: (r: Response) => boolean): Rate {
  return { correct: responses.filter(ok).length, total: responses.length }
}

export type Summary = {
  byCondition: Record<Condition, Response[]>
  questionRates: Record<Condition, Record<number, Rate>>
}

export function summarize(responses: Response[]): Summary {
  const byCondition = { ai: [], helper: [], self: [] } as Record<Condition, Response[]>
  for (const r of responses) byCondition[r.condition].push(r)
  const questionRates = {} as Summary['questionRates']
  for (const c of CONDITIONS) {
    questionRates[c] = Object.fromEntries(QUESTIONS.map((q) => [q, rate(byCondition[c], (r) => questionCorrect(r, q))]))
  }
  return { byCondition, questionRates }
}
