import { useState, type FormEvent } from 'react'
import type { FeedEntry } from '../../../shared/protocol'
import './ChatFeed.css'

interface ChatFeedProps {
  /** newest first */
  entries: FeedEntry[]
  /** my player id, to mark my own lines */
  meId: string
  /** false while drawing (the drawer knows the word) or between rounds */
  canGuess: boolean
  onGuess: (text: string) => void
  /** transient "so close!" nudge for my last near-miss guess */
  closeNudge: string | null
}

/**
 * The shared guess feed: human guesses, AI guesses, and system lines all in
 * one stream — the AI reads as just another player in the room.
 */
export default function ChatFeed({ entries, meId, canGuess, onGuess, closeNudge }: ChatFeedProps) {
  const [draft, setDraft] = useState('')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    onGuess(text)
    setDraft('')
  }

  return (
    <aside className="chat-feed" aria-label="guesses">
      <h2 className="chat-feed-title">
        <span className="chat-feed-dot" aria-hidden="true" />
        Guesses
      </h2>
      <form className="chat-feed-form" onSubmit={submit}>
        <input
          className="chat-feed-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={canGuess ? 'type your guess…' : 'watch and wait…'}
          disabled={!canGuess}
          maxLength={40}
          aria-label="your guess"
        />
        <button type="submit" disabled={!canGuess} className="chat-feed-send">
          Guess
        </button>
      </form>
      {closeNudge && <p className="hand-note chat-feed-close">“{closeNudge}” is so close!</p>}
      {entries.length === 0 && <p className="hand-note chat-feed-empty">…nothing yet</p>}
      <ol className="chat-feed-list">
        {entries.map((e) => (
          <li
            key={e.id}
            className={`chat-feed-item is-${e.kind}${e.isAi ? ' is-ai' : ''}${
              e.playerId === meId ? ' is-me' : ''
            }`}
          >
            {e.kind === 'system' ? (
              <span className="hand-note chat-feed-system">{e.text}</span>
            ) : e.kind === 'correct' ? (
              <span className="chat-feed-text">{e.name} guessed it! ✓</span>
            ) : (
              <span className="chat-feed-text">
                <span className="chat-feed-name">{e.name}</span> {e.text}
                {e.isAi ? '?' : ''}
              </span>
            )}
          </li>
        ))}
      </ol>
    </aside>
  )
}
