/**
 * Answer key from 최종본.pdf (진행자용 정답 및 해설, pages 9–10).
 * Amounts are in 만 원. Each part is worth 1 point; 7, 8, 11, 12 have two parts.
 */
export type Part = {
  /** Matches the form column, e.g. "7번 (1)". */
  id: string
  question: number
  kind: 'choice' | 'amount' | 'yesno'
  answer: number | string
}

export const PARTS: Part[] = [
  { id: '1번', question: 1, kind: 'choice', answer: 2 },
  { id: '2번', question: 2, kind: 'choice', answer: 3 },
  { id: '3번', question: 3, kind: 'choice', answer: 4 },
  { id: '4번', question: 4, kind: 'choice', answer: 2 },
  { id: '5번', question: 5, kind: 'amount', answer: 200 },
  { id: '6번', question: 6, kind: 'amount', answer: 12 },
  { id: '7번 (1)', question: 7, kind: 'amount', answer: 16 },
  // "수업료에서 장학금을 빼는가" → 빼지 않는다
  { id: '7번 (2)', question: 7, kind: 'yesno', answer: '아니오' },
  { id: '8번 (1)', question: 8, kind: 'amount', answer: 100 },
  { id: '8번 (2)', question: 8, kind: 'amount', answer: 10 },
  { id: '9번', question: 9, kind: 'choice', answer: 2 },
  { id: '10번', question: 10, kind: 'choice', answer: 3 },
  { id: '11번 (1)', question: 11, kind: 'amount', answer: 180 },
  { id: '11번 (2)', question: 11, kind: 'amount', answer: 18 },
  { id: '12번 (1)', question: 12, kind: 'amount', answer: 20 },
  { id: '12번 (2)', question: 12, kind: 'amount', answer: 0 },
]

export const QUESTIONS = Array.from({ length: 12 }, (_, i) => i + 1)
export const MAX_SCORE = PARTS.length // 16
