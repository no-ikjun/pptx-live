import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { Deck, Slide } from '../model'
import { animState, doneClock, freshClock, nextClickStep, type BuildClock } from './builds'
import { loadFonts, setFontKinds } from './fonts'
import type { LiveHook } from './live'
import { MediaContext, SlideShapes, fillCss, type SlideOverrides } from './render'

type NavState = { pos: number; clock: BuildClock }

// ---- slide frame -----------------------------------------------------------------

export function SlideFrame({
  deck,
  slide,
  overrides,
  clock,
  now,
  scale,
  uid,
  media,
}: {
  deck: Deck
  slide: Slide
  overrides?: SlideOverrides
  clock: BuildClock
  now: number
  scale: number
  uid: string
  media: (s: string) => string
}) {
  const builds = overrides?.builds === false ? undefined : animState(slide.steps, clock, now).anim
  const bg: CSSProperties = slide.background ? fillCss(slide.background, media) : { background: '#fff' }
  return (
    <div style={{ width: deck.width * scale, height: deck.height * scale, position: 'relative', overflow: 'hidden' }}>
      <div
        key={`${uid}-${slide.index}`}
        className={slide.transition.kind === 'fade' ? 'slide fade-in' : 'slide'}
        style={{
          width: deck.width,
          height: deck.height,
          transform: `scale(${scale})`,
          transformOrigin: '0 0',
          animationDuration: `${slide.transition.durMs}ms`,
          ...bg,
        }}
      >
        <SlideShapes shapes={slide.shapes} o={overrides} anim={builds} uid={`${uid}-${slide.index}`} />
      </div>
    </div>
  )
}

// ---- navigation state, shared with the presenter window -----------------------

function useNav(deck: Deck, channelName: string) {
  const visible = useMemo(() => deck.slides.filter((s) => !s.hidden), [deck])
  const fromHash = () => {
    const n = Number(window.location.hash.replace(/^#\/?/, ''))
    const i = visible.findIndex((s) => s.index === n)
    return i >= 0 ? i : 0
  }
  const [nav, setNav] = useState<NavState>(() => ({ pos: fromHash(), clock: freshClock(Date.now()) }))
  const channel = useRef<BroadcastChannel | null>(null)
  const remote = useRef(false)
  const navRef = useRef(nav)

  useEffect(() => {
    const ch = new BroadcastChannel(channelName)
    channel.current = ch
    ch.onmessage = (e) => {
      if (e.data?.type === 'nav') {
        remote.current = true
        setNav(e.data.nav)
      }
      if (e.data?.type === 'hello') ch.postMessage({ type: 'nav', nav: navRef.current })
    }
    ch.postMessage({ type: 'hello' })
    return () => ch.close()
  }, [channelName])

  useEffect(() => {
    navRef.current = nav
    const slide = visible[nav.pos]
    if (slide) history.replaceState(null, '', `${window.location.search}#/${slide.index}`)
    if (remote.current) remote.current = false
    else channel.current?.postMessage({ type: 'nav', nav })
  }, [nav, visible])

  useEffect(() => {
    const onHash = () => setNav((n) => (fromHash() === n.pos ? n : { pos: fromHash(), clock: freshClock(Date.now()) }))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  const goTo = useCallback(
    (pos: number, atEnd = false) => {
      const p = Math.max(0, Math.min(visible.length - 1, pos))
      setNav({ pos: p, clock: atEnd ? doneClock() : freshClock(Date.now()) })
    },
    [visible.length],
  )

  const next = useCallback(() => {
    setNav((n) => {
      const steps = visible[n.pos]?.steps ?? []
      const k = nextClickStep(steps, n.clock)
      if (k !== null) {
        const clicks = [...n.clock.clicks]
        clicks[k] = Date.now()
        return { pos: n.pos, clock: { ...n.clock, clicks } }
      }
      if (n.pos >= visible.length - 1) return n
      return { pos: n.pos + 1, clock: freshClock(Date.now()) }
    })
  }, [visible])

  const prev = useCallback(() => {
    setNav((n) => {
      // A slide entered backwards shows every build; undo them one click at a
      // time from there, like PowerPoint.
      const steps = visible[n.pos]?.steps ?? []
      const clock: BuildClock = n.clock.done
        ? { slideStart: 0, clicks: steps.map((s) => (s.auto ? undefined : 0)), done: false }
        : n.clock
      const last = clock.clicks.reduce<number>((acc, t, i) => (t !== undefined ? i : acc), -1)
      if (last >= 0) {
        const clicks = clock.clicks.slice(0, last)
        return { pos: n.pos, clock: { ...clock, clicks } }
      }
      if (n.pos === 0) return n
      return { pos: n.pos - 1, clock: doneClock() }
    })
  }, [visible])

  return { visible, nav, goTo, next, prev }
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    let id = 0
    const tick = () => {
      setNow(Date.now())
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [active])
  return active ? now : Date.now()
}

function useFit(w: number, h: number, box?: { w: number; h: number }) {
  const [scale, setScale] = useState(1)
  useLayoutEffect(() => {
    const fit = () => setScale(Math.min((box?.w ?? window.innerWidth) / w, (box?.h ?? window.innerHeight) / h))
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [w, h, box?.w, box?.h])
  return scale
}

// ---- app -------------------------------------------------------------------------

export function DeckApp({ deck, name, media, useLive }: { deck: Deck; name: string; media: (s: string) => string; useLive: LiveHook }) {
  const params = new URLSearchParams(window.location.search)
  const presenter = params.has('presenter')
  // ?capture renders at 1:1 with every build finished, for screenshots.
  const capture = params.has('capture')
  const { visible, nav, goTo, next, prev } = useNav(deck, `pptx-live:${name}`)
  const slide = visible[nav.pos]
  const live = useLive({ deck, slide: slide?.index ?? 1 })
  const overrides = slide ? live.slides?.[slide.index] : undefined
  const [panel, setPanel] = useState(false)
  const [blank, setBlank] = useState<null | 'black' | 'white'>(null)
  const jump = useRef('')
  const animating = slide ? animState(slide.steps, nav.clock, Date.now()).active : false
  const now = useNow(animating)
  const fitScale = useFit(deck.width, deck.height)
  const scale = capture ? 1 : fitScale

  setFontKinds(deck.fontKinds)
  useEffect(() => loadFonts(deck.fonts), [deck.fonts])
  useEffect(() => {
    document.title = presenter ? `Presenter · ${deck.title}` : deck.title
  }, [deck.title, presenter])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPanel(false)
        setBlank(null)
        ;(document.activeElement as HTMLElement | null)?.blur()
        return
      }
      if ((e.target as HTMLElement).closest('input, textarea, select, button, video')) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (slide && live.onKey?.(e, slide.index)) {
        e.preventDefault()
        return
      }
      if (/^\d$/.test(e.key)) {
        jump.current = (jump.current + e.key).slice(-3)
        return
      }
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
        case ' ':
          if (e.key === ' ' && e.shiftKey) prev()
          else next()
          break
        case 'Enter':
          if (jump.current) {
            const i = visible.findIndex((s) => s.index === Number(jump.current))
            if (i >= 0) goTo(i)
          } else next()
          jump.current = ''
          break
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
        case 'Backspace':
          prev()
          break
        case 'Home':
          goTo(0)
          break
        case 'End':
          goTo(visible.length - 1)
          break
        case 'f':
        case 'F':
          if (document.fullscreenElement) document.exitFullscreen()
          else document.documentElement.requestFullscreen().catch(() => {})
          break
        case 'p':
        case 'P':
          if (!presenter) window.open(`${window.location.pathname}${window.location.search ? window.location.search + '&' : '?'}presenter=1${window.location.hash}`, `presenter-${name}`, 'width=1280,height=800')
          break
        case 'b':
        case 'B':
        case '.':
          setBlank((b) => (b ? null : 'black'))
          break
        case 'w':
        case 'W':
          setBlank((b) => (b ? null : 'white'))
          break
        case 'd':
        case 'D':
          if (live.panel) setPanel((p) => !p)
          break
        default:
          return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [slide, live, next, prev, goTo, visible, presenter, name])

  if (!slide) return <div className="empty">This deck has no visible slides.</div>

  const frame = (s: Slide, sc: number, uid: string, clock = nav.clock, o = overrides) => (
    <SlideFrame deck={deck} slide={s} overrides={o} clock={clock} now={now} scale={sc} uid={uid} media={media} />
  )

  return (
    <MediaContext.Provider value={media}>
      {presenter ? (
        <PresenterView deck={deck} visible={visible} nav={nav} frame={frame} overridesFor={(n) => live.slides?.[n]} />
      ) : (
        <div
          className="viewport"
          onClick={(e) => {
            if (panel) return
            if (e.clientX < window.innerWidth / 4) prev()
            else next()
          }}
        >
          <div className={capture ? 'stage capture' : 'stage'}>{frame(slide, scale, 'main', capture ? doneClock() : nav.clock)}</div>
          {blank && <div className="blank" style={{ background: blank }} />}
        </div>
      )}
      {panel && live.panel && (
        <div className="panel-backdrop" onClick={() => setPanel(false)}>
          <aside className="panel" onClick={(e) => e.stopPropagation()}>
            {live.panel}
          </aside>
        </div>
      )}
    </MediaContext.Provider>
  )
}

function PresenterView({
  deck,
  visible,
  nav,
  frame,
  overridesFor,
}: {
  deck: Deck
  visible: Slide[]
  nav: NavState
  frame: (s: Slide, scale: number, uid: string, clock?: BuildClock, o?: SlideOverrides) => React.ReactNode
  overridesFor: (n: number) => SlideOverrides | undefined
}) {
  const [started] = useState(() => Date.now())
  const [, tick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => tick((t) => t + 1), 1000)
    return () => window.clearInterval(id)
  }, [])
  const slide = visible[nav.pos]
  const nextSlide = visible[nav.pos + 1]
  const pendingClicks = slide.steps.filter((s, i) => !s.auto && nav.clock.clicks[i] === undefined && !nav.clock.done).length
  const elapsed = Math.floor((Date.now() - started) / 1000)
  const mainW = Math.min(window.innerWidth * 0.6, 1100)
  return (
    <div className="presenter">
      <div className="presenter-main">
        {frame(slide, mainW / deck.width, 'pv')}
        <div className="presenter-meta">
          <span>
            {slide.index} / {deck.slides.length}
            {pendingClicks > 0 && ` · 클릭 ${pendingClicks}번 남음`}
          </span>
          <span>
            {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')} · {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>
      <div className="presenter-side">
        <div className="presenter-label">다음</div>
        {nextSlide ? frame(nextSlide, 360 / deck.width, 'pn', doneClock(), overridesFor(nextSlide.index)) : <div className="presenter-end">마지막 슬라이드</div>}
        <div className="presenter-label">노트</div>
        <div className="presenter-notes">{slide.notes || '노트 없음'}</div>
      </div>
    </div>
  )
}
