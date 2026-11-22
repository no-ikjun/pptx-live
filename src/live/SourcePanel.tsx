import { useRef, useState, type ReactNode } from 'react'
import type { CsvSource } from './source'

function toLocalInput(d: Date) {
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Ready-made panel (D key) for choosing where live data comes from. Put deck-specific summaries in children. */
export function SourcePanel({ source, title = '결과 데이터', children }: { source: CsvSource; title?: string; children?: ReactNode }) {
  const file = useRef<HTMLInputElement>(null)
  const [sheet, setSheet] = useState(source.sheetId)
  const { status } = source
  return (
    <div className="source-panel">
      <h2>{title}</h2>
      <section>
        <h3>가져올 곳</h3>
        <label className="row">
          <input type="radio" checked={source.source === 'sheet'} onChange={() => source.selectSheet(sheet)} />
          구글 시트 (몇 초마다 새로 읽기)
        </label>
        <div className="row indent">
          <input className="grow" value={sheet} onChange={(e) => setSheet(e.target.value)} placeholder="시트 주소 또는 ID" />
          <button onClick={() => source.selectSheet(sheet)}>연결</button>
        </div>
        {source.source === 'sheet' && (
          <p className={`note indent ${status.ok ? 'ok' : 'err'}`}>
            {status.ok
              ? `연결됨 · ${status.at?.toLocaleTimeString()}에 읽음`
              : status.error
                ? `읽지 못했어요: ${status.error}${status.at ? ` · 마지막 성공 ${status.at.toLocaleTimeString()}` : ''}`
                : '읽는 중…'}
            <button className="link" onClick={() => source.refresh()}>
              지금 새로고침
            </button>
          </p>
        )}
        <label className="row">
          <input type="radio" checked={source.source === 'upload'} onChange={() => file.current?.click()} />
          CSV 파일 {source.source === 'upload' && source.csvName ? `· ${source.csvName}` : ''}
        </label>
        <div className="row indent">
          <button onClick={() => file.current?.click()}>파일 선택</button>
          <span className="note">화면 어디에나 끌어다 놓아도 돼요</span>
          <input
            ref={file}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (f) source.selectUpload(await f.text(), f.name)
              e.target.value = ''
            }}
          />
        </div>
        {source.hasSample && (
          <label className="row">
            <input type="radio" checked={source.source === 'sample'} onChange={() => source.selectSample()} />
            샘플 데이터 (리허설용)
          </label>
        )}
      </section>
      <section>
        <h3>집계 시작 시각</h3>
        <p className="note">이 시각 이전 응답(테스트 제출 등)은 빼고 집계해요.</p>
        <div className="row">
          <input
            type="datetime-local"
            value={source.since ? toLocalInput(new Date(source.since)) : ''}
            onChange={(e) => source.setSince(e.target.value ? new Date(e.target.value).toISOString() : null)}
          />
          <button onClick={() => source.setSince(new Date().toISOString())}>지금부터</button>
          {source.since && (
            <button className="ghost" onClick={() => source.setSince(null)}>
              해제
            </button>
          )}
        </div>
      </section>
      {children}
      <section>
        <h3>단축키</h3>
        <p className="note">
          → / ← 넘기기 · 숫자+Enter 이동 · F 전체화면 · P 발표자 화면 · B 검은 화면 · D 이 창
        </p>
      </section>
    </div>
  )
}
