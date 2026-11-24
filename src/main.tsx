import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Deck } from './model'
import { DeckApp } from './engine/DeckApp'
import { defineLive, withLiveSteps, type LiveHook } from './engine/live'
import './styles.css'

// Every folder in decks/ with a deck.json is a deck. Its live.tsx is optional.
const deckFiles = import.meta.glob<Deck>('../decks/*/deck.json', { import: 'default' })
const liveFiles = import.meta.glob<LiveHook>('../decks/*/live.tsx', { import: 'default' })
const mediaFiles = import.meta.glob<string>('../decks/*/media/*', { query: '?url', import: 'default', eager: true })

const nameOf = (path: string) => path.split('/')[2]
const names = Object.keys(deckFiles).map(nameOf).sort()
const noLive = defineLive(() => ({}))

function Root() {
  const requested = new URLSearchParams(window.location.search).get('deck')
  const name = requested ?? (names.length === 1 ? names[0] : null)
  const [loaded, setLoaded] = useState<{ deck: Deck; live: LiveHook } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!name) return
    const load = deckFiles[`../decks/${name}/deck.json`]
    if (!load) {
      setError(`No deck named "${name}" in decks/.`)
      return
    }
    const live = liveFiles[`../decks/${name}/live.tsx`]
    Promise.all([load(), live ? live() : Promise.resolve(noLive)])
      .then(([deck, hook]) => setLoaded({ deck: withLiveSteps(deck, hook), live: hook }))
      .catch((e) => setError(String(e)))
  }, [name])

  if (error) return <div className="empty">{error}</div>
  if (!name) return <DeckList />
  if (!loaded) return <div className="empty" />
  const media = (src: string) => mediaFiles[`../decks/${name}/${src}`] ?? src
  return <DeckApp deck={loaded.deck} name={name} media={media} useLive={loaded.live} />
}

function DeckList() {
  return (
    <main className="deck-list">
      <h1>Decks</h1>
      {names.length === 0 ? (
        <p>
          No decks yet. Run <code>npm run import -- your-deck.pptx</code>.
        </p>
      ) : (
        <ul>
          {names.map((n) => (
            <li key={n}>
              <a href={`?deck=${encodeURIComponent(n)}`}>{n}</a>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
