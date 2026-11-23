# pptx-live

PowerPoint 발표 자료를 그대로 웹 발표 자료로 옮기고, 그 위에 실시간 데이터(구글 시트, CSV, 타이머 등)를 코드로 연결하는 템플릿이에요.

- **원본 그대로:** PPTX의 도형 위치·글꼴·색·줄간격·표·차트·그룹·클릭 애니메이션을 1920px 기준 좌표로 옮겨 그려요.
- **어디서든 열림:** 결과물은 정적 사이트라서 Vercel·Netlify·GitHub Pages 어디든 올릴 수 있어요.
- **실시간 연결은 코드로:** 바꾸고 싶은 슬라이드만 `live.tsx`에 적으면 돼요. 글자, 표 칸, 차트 데이터, 도형을 바꿀 수 있어요.

## 시작하기

```bash
npm install
npm run import -- "발표.pptx"
npm run dev
```

`npm run import`는 `decks/<이름>/`에 다음을 만들어요.

- `deck.json`: 변환된 슬라이드
- `media/`: 이미지와 동영상
- `live.tsx`: 실시간 코드를 적는 빈 파일. 이미 있으면 덮어쓰지 않아요.

변환이 끝나면 쓰인 글꼴과 원본과 다르게 보일 수 있는 부분을 알려줘요. 이름은 `--name my-talk`로 정할 수 있어요.

`decks/`에 발표가 하나뿐이면 첫 화면에 바로 열려요. 여러 개면 `?deck=이름`으로 골라요.

## 발표 중 조작

| 키 | 동작 |
| --- | --- |
| → / Space / 클릭 | 다음 애니메이션 또는 다음 슬라이드 |
| ← / Backspace / 화면 왼쪽 클릭 | 이전 |
| 숫자 + Enter | 해당 번호 슬라이드로 이동 |
| F | 전체화면 |
| P | 발표자 화면 (현재·다음 슬라이드, 노트, 경과 시간). 두 창이 함께 넘어가요. |
| B / W | 화면을 검게 / 하얗게 |
| D | `live.tsx`가 만든 데이터 창 |

## 실시간 코드 (`live.tsx`)

`live.tsx`는 React 훅이에요. 안에서 데이터를 불러오고, 슬라이드 번호(PowerPoint 기준)별로 바꿀 내용을 돌려줘요. 도형은 **PowerPoint의 선택 창에서 붙인 이름**으로 찾으면 가장 편해요.

```tsx
import { defineLive, textLike, useCsvSource, SourcePanel } from '../../src/live'
import Papa from 'papaparse'

export default defineLive(() => {
  const source = useCsvSource({ storageKey: 'my-talk', sheetId: '<구글 시트 ID>' })
  const rows = source.csv ? Papa.parse<string[]>(source.csv).data.slice(1) : []

  return {
    slides: {
      3: {
        // 이름이 "Count"인 도형의 글자를 응답 수로 바꿔요. 모양은 원래 글자 그대로예요.
        box: (s) => (s.name === 'Count' ? { para: (p) => textLike(p, String(rows.length)) } : undefined),
      },
    },
    panel: <SourcePanel source={source} />,
  }
})
```

슬라이드마다 쓸 수 있는 것:

| 항목 | 하는 일 |
| --- | --- |
| `box(shape)` | 도형의 글자(`para`)나 채우기 색(`fill`)을 바꾸거나, 안에 요소(`children`)를 더해요. |
| `cell(table, row, col)` | 표의 한 칸을 바꿔요. |
| `chart(chart)` | PPT 차트의 데이터나 설정을 바꿔요. 디자인은 PPT 차트 그대로예요. |
| `replace(shape)` | 도형을 통째로 바꿔요. `null`이면 숨겨요. |
| `builds: false` | 그 슬라이드의 PPT 애니메이션을 끄고 직접 그려요. |

함께 들어 있는 도구(`src/live`):

- **`useCsvSource`:** 구글 시트를 몇 초마다 읽어요. CSV 파일 끌어다 놓기와 샘플 데이터도 지원하고, 마지막으로 받은 데이터를 브라우저에 저장해요.
- **`SourcePanel`:** 데이터 출처, 시트 연결 상태, 집계 시작 시각을 고르는 D 창이에요.
- **`useCountdowns`:** 슬라이드에 들어가면 자동으로 시작하는 타이머예요. 일시정지와 처음으로 되돌리기가 돼요.

전체 예제는 [`decks/edu-econ/live.tsx`](decks/edu-econ/live.tsx)예요. 구글 폼 응답을 채점해 결과 슬라이드 5장(점 그래프, 문항별 정답률 표, 체감 난이도)을 채우고, 13분·7분·5분 타이머를 돌려요.

> **구글 시트 연결:** 시트를 "링크가 있는 모든 사용자: 보기"로 공유해야 해요. 구글의 CSV 내보내기는 열마다 숫자/글자 중 많은 쪽으로 형식을 정해서, 섞인 값(예: 숫자 열의 "16만원")을 빈칸으로 보낼 수 있어요. 응답 열을 *서식 → 숫자 → 일반 텍스트*로 바꿔 두면 안전해요.

## 배포

```bash
npm run build
```

`dist/`를 정적 호스팅에 올리면 돼요. Vercel이나 Netlify는 저장소를 연결하기만 하면 Vite 프로젝트로 알아서 빌드해요.

## 글꼴

PPT에 쓰인 글꼴이 보는 사람 컴퓨터에 없을 때를 대비해 대체 글꼴을 자동으로 붙여요.

- 한글 기본 글꼴 Pretendard는 프로젝트에 포함돼 있어요.
- Calibri→Carlito, Arial→Arimo, Times New Roman→Tinos, 맑은 고딕→Noto Sans KR, 나눔고딕, SUITE 등은 웹 글꼴로 불러와요.
- 알 수 없는 글꼴은 PPT에 기록된 분류 정보(PANOSE)를 보고 명조/고딕/고정폭 대체 글꼴을 골라요.

대체 글꼴은 글자 폭이 달라 줄바꿈이 원본과 다를 수 있어요. 목록은 `src/engine/fonts.ts`에서 늘릴 수 있어요.

## 지원 범위와 한계

실제 발표 자료 8개(강의·피치덱·세미나 자료, 슬라이드 258장, 16:9와 비16:9 포함)를 Keynote 렌더링과 비교하며 맞췄어요.

**지원해요**

- 슬라이드 마스터·레이아웃 상속, 테마 색과 글꼴
- 그라데이션, 이미지 채우기, 화살표와 점선, 사용자 지정 도형과 자주 쓰는 기본 도형
- 그룹, 표(병합, 표 스타일), 차트(막대·선·영역·원·도넛·분산형)
- SmartArt(PPT에 저장된 그림 사용), 동영상, 하이퍼링크, 발표자 노트, 숨긴 슬라이드
- 클릭·자동 애니메이션: 나타내기, 페이드, 닦아내기, 날아오기, 확대. 그 밖의 효과는 페이드로 바꿔 재생해요.

**아직 안 돼요** (가져올 때 알려줘요)

- 강조 애니메이션, 단락별 애니메이션(도형 단위로 재생돼요), 트리거 애니메이션
- EMF/WMF 이미지: 브라우저가 못 그려서 빠져요. PNG나 SVG로 바꿔 넣으면 돼요.
- 3D 효과, 그림자·반사 같은 효과, 일부 특수 도형(사각형으로 그려요), 혼합 차트(첫 종류만 그려요)
