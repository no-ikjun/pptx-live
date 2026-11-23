import { useMemo } from 'react'
import { BoxView, RunSpan, SourcePanel, defineLive, formatClock, remaining, textLike, useCountdowns, useCsvSource, type Para, type SlideOverrides } from '../../src/live'
import { MAX_SCORE, PARTS } from './answerKey'
import { CONDITIONS, CONDITION_LABEL, parseCsv, questionCorrect, rate, summarize, type Condition, type Rate, type Summary } from './grade'

/**
 * 교육의 경제학 6조: the exam answers come from a Google Form's response sheet,
 * are graded here, and fill the result slides (15–19). Slides 10 and 12 get
 * pausable countdowns in place of the PPT's timed animation.
 */

const SHEET_ID = '1YF-k7SX1jh2KG1TmAgjwruE2-CFvjI4DzKiseO4AwCI'
const TIMERS = { 10: 13 * 60_000, 12: 7 * 60_000 }

// ---- rehearsal data --------------------------------------------------------------

function sampleCsv() {
  const header = ['타임스탬프', '자신이 속한 조는?', ...PARTS.map((p) => p.id), '이번 시험의 난이도는 어땠나요?']
  const labels = { ai: 'AI 활용', helper: '학습 도우미에게 질문 가능', self: '독학' }
  const skill = { ai: 0.62, helper: 0.72, self: 0.66 }
  let seed = 7
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const rows = [header.join(',')]
  for (const c of CONDITIONS)
    for (let i = 0; i < 8; i++) {
      const cells = PARTS.map((p) => {
        const right = rand() < skill[c]
        if (p.kind === 'choice') return right ? p.answer : ((p.answer as number) % 4) + 1
        if (p.kind === 'yesno') return right ? p.answer : '예'
        return right ? p.answer : (p.answer as number) + 10
      })
      rows.push(['2026. 11. 25 오후 3:30:00', labels[c], ...cells, String(1 + Math.floor(rand() * 5))].join(','))
    }
  return rows.join('\n')
}

// ---- formatting ------------------------------------------------------------------

const pct = (r: Rate) => (r.total ? Math.round((r.correct / r.total) * 100) : null)

/** "67%" in the cell's own style plus a smaller "(4/6)". */
function rateRuns(p: Para, r: Rate, light = false) {
  const v = pct(r)
  if (v === null) return undefined
  const base = p.runs[0]
  return (
    <>
      <RunSpan r={{ ...base, t: `${v}%`, bold: true, color: light ? '#FFFFFF' : base.color }} />
      <RunSpan r={{ ...base, t: ` (${r.correct}/${r.total})`, bold: false, size: base.size * 0.78, color: light ? '#EEF3FC' : '#6B7684' }} />
    </>
  )
}

// Slide 16 legend: 0–20, 20–40, 40–60, 60–80, 80–100 %.
const HEAT = ['#EEF3FC', '#C9D7F4', '#94B0E8', '#5C85D6', '#2B59C3']
const ROW_NAME: Record<string, Condition> = { AI: 'ai', '학습 도우미': 'helper', 독학: 'self' }
const partRate = (s: Summary, c: Condition, id: string) => rate(s.byCondition[c], (r) => r.parts[id] === 1)

const TABLE_ROWS: Record<string, ((s: Summary, c: Condition) => Rate)[]> = {
  'Scholarship Table': [(s, c) => s.questionRates[c][3], (s, c) => partRate(s, c, '7번 (2)')],
  'Age Table': [(s, c) => s.questionRates[c][1], (s, c) => rate(s.byCondition[c], (r) => questionCorrect(r, 8))],
  'Limit Table': [(s, c) => s.questionRates[c][5], (s, c) => s.questionRates[c][4], (s, c) => partRate(s, c, '12번 (2)')],
}

// ---- slides ----------------------------------------------------------------------

function resultSlides(summary: Summary): Record<number, SlideOverrides> {
  const ROW_Y: Record<Condition, number> = { ai: 3, helper: 2, self: 1 }
  const tableSlide: SlideOverrides = {
    cell: (t, row, col) => {
      const rows = TABLE_ROWS[t.name]
      if (!rows || row === 0 || col < 1 || !rows[row - 1]) return undefined
      const r = rows[row - 1](summary, CONDITIONS[col - 1])
      return { para: (p) => rateRuns(p, r) }
    },
  }
  return {
    15: {
      // The PPT's own scatter chart, with participants stacked per score and the means as diamonds.
      chart: (c) => {
        const series = c.chart.series.map((s, i) => {
          if (i < 3) {
            const cond = CONDITIONS[i]
            const seen = new Map<number, number>()
            const pts = summary.byCondition[cond].map((r) => {
              const k = seen.get(r.score) ?? 0
              seen.set(r.score, k + 1)
              return [r.score, ROW_Y[cond] + k * 0.11] as const
            })
            return { ...s, xValues: pts.map((p) => p[0]), values: pts.map((p) => p[1]) }
          }
          const means = CONDITIONS.filter((c2) => summary.byCondition[c2].length)
          return {
            ...s,
            xValues: means.map((c2) => summary.byCondition[c2].reduce((a, r) => a + r.score, 0) / summary.byCondition[c2].length),
            values: means.map((c2) => ROW_Y[c2] - 0.2),
          }
        })
        return { ...c.chart, series }
      },
      box: (s) => {
        const m = s.name.match(/^Stat (.+) (인원|평균|범위)$/)
        const rs = m ? summary.byCondition[ROW_NAME[m[1]]] : undefined
        if (!m || !rs?.length) return undefined
        const scores = rs.map((r) => r.score)
        const text =
          m[2] === '인원' ? String(rs.length) : m[2] === '평균' ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : `${Math.min(...scores)}–${Math.max(...scores)}`
        return { para: (p) => textLike(p, text) }
      },
    },
    16: {
      cell: (t, row, col) => {
        if (t.name !== 'Item Accuracy Table' || row === 0 || col < 2) return undefined
        const r = summary.questionRates[CONDITIONS[col - 2]][row]
        const v = pct(r)
        if (v === null) return undefined
        return { fill: HEAT[Math.min(4, Math.floor(v / 20))], para: (p) => rateRuns(p, r, v >= 60) }
      },
    },
    17: tableSlide,
    18: tableSlide,
    19: tableSlide,
  }
}

/** Slides 10 and 12: digits and a smoothly draining bar, like the PPT's animation. */
function timerSlide(left: number, duration: number, started: boolean): SlideOverrides {
  const done = left === 0
  const text = formatClock(left)
  const filled = (left / duration) * 60
  const lastMinute = left <= 60_000 && started
  return {
    builds: false,
    replace: (s) => {
      if (/^Timer (p\d|colon|cover|end)/.test(s.name)) return null
      const seg = s.name.match(/^Progress Seg (\d+)$/)
      if (seg && s.kind === 'shape') {
        const visible = Math.min(1, Math.max(0, filled - (Number(seg[1]) - 1)))
        if (visible <= 0) return null
        return visible >= 1 ? undefined : <BoxView s={{ ...s, w: s.w * visible }} />
      }
      if (s.name === 'Self Check' && !lastMinute) return null
      if (s.name === 'Rule Note' && lastMinute) return null
      return undefined
    },
    box: (s) => {
      const m = s.name.match(/^Timer start (\d)$/)
      if (!m) return undefined
      return { para: (p) => textLike(p, text[Number(m[1])] ?? '', done ? { color: '#6F9BFF' } : {}) }
    },
  }
}

export default defineLive(({ slide }) => {
  const source = useCsvSource({ storageKey: 'edu-econ', sheetId: SHEET_ID, sample: sampleCsv })
  const parsed = useMemo(() => (source.csv ? parseCsv(source.csv) : { responses: [], skipped: 0, missingColumns: [] }), [source.csv])
  const responses = useMemo(() => {
    const since = source.since ? new Date(source.since) : null
    return parsed.responses.filter((r) => !since || !r.timestamp || r.timestamp >= since)
  }, [parsed, source.since])
  const summary = useMemo(() => summarize(responses), [responses])
  const { timers, now, toggle, reset } = useCountdowns(TIMERS, slide)

  const slides: Record<number, SlideOverrides> = { ...resultSlides(summary) }
  for (const n of [10, 12] as const) {
    const t = timers[n]
    slides[n] = timerSlide(remaining(t, now), t.durationMs, t.startedAt !== null || t.elapsedMs > 0)
  }

  return {
    slides,
    onKey: (e, n) => {
      if (!(n in TIMERS)) return false
      if (e.key === ' ') toggle(n)
      else if (e.key === 'r' || e.key === 'R') reset(n)
      else return false
      return true
    },
    panel: (
      <SourcePanel source={source}>
        <section>
          <h3>지금 집계</h3>
          <table>
            <thead>
              <tr>
                <th />
                <th>인원</th>
                <th>평균</th>
              </tr>
            </thead>
            <tbody>
              {CONDITIONS.map((c) => {
                const rs = summary.byCondition[c]
                return (
                  <tr key={c}>
                    <td>{CONDITION_LABEL[c]}</td>
                    <td>{rs.length}</td>
                    <td>{rs.length ? `${(rs.reduce((a, r) => a + r.score, 0) / rs.length).toFixed(1)} / ${MAX_SCORE}` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="note">
            전체 {parsed.responses.length}건 중 {responses.length}건 집계
            {parsed.skipped > 0 && ` · 조를 읽지 못한 ${parsed.skipped}건 제외`}
          </p>
          {parsed.missingColumns.length > 0 && <p className="note err">시트에 없는 문항 열: {parsed.missingColumns.join(', ')}</p>}
        </section>
      </SourcePanel>
    ),
  }
})
