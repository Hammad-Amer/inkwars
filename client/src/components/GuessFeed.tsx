import './GuessFeed.css'

export interface FeedEntry {
  id: number
  category: string
  confidence: number
  /** ms since round start */
  atMs: number
  correct: boolean
}

/** Live feed of the AI's guesses, newest first. Correct guess gets celebrated. */
export default function GuessFeed({ entries }: { entries: FeedEntry[] }) {
  return (
    <aside className="guess-feed" aria-live="polite" aria-label="AI guesses">
      <h2 className="guess-feed-title">
        <span className="guess-feed-dot" aria-hidden="true" />
        AI is watching
      </h2>
      {entries.length === 0 && <p className="hand-note guess-feed-empty">…squinting at the canvas</p>}
      <ol className="guess-feed-list">
        {entries.map((e) => (
          <li key={e.id} className={`guess-feed-item${e.correct ? ' is-correct' : ''}`}>
            <span className="guess-feed-text">
              {e.correct ? `${e.category}! ✓` : `${e.category}?`}
            </span>
            <span className="guess-feed-at">{(e.atMs / 1000).toFixed(0)}s</span>
          </li>
        ))}
      </ol>
    </aside>
  )
}
