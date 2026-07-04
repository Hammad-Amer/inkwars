import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  MEMORY_HIDE_AFTER_MS,
  ROUND_DURATION_MS,
  type ChaosLevel,
  type ChaosModifier,
  type FeedEntry,
  type JoinResult,
  type NormPoint,
  type RoomPhase,
  type RoomState,
  type RoundReveal,
  type StrokeEvent,
} from '../../../shared/protocol'
import { ChaosBadge, ChaosBanner } from '../components/Chaos'
import ChatFeed from '../components/ChatFeed'
import DrawingCanvas from '../components/DrawingCanvas'
import LiveCanvas from '../components/LiveCanvas'
import { AiPlayer } from '../lib/aiPlayer'
import { Guesser } from '../lib/guesser'
import { transformFor } from '../lib/chaos'
import { getSocket } from '../lib/socket'
import { StrokeSender, StrokeStore } from '../lib/strokeWire'
import type { Stroke } from '../lib/strokes'
import './Room.css'

const STROKE_EMIT_INTERVAL_MS = 50 // mid-stroke batching; stroke ends flush immediately
const NAME_STORAGE_KEY = 'drawing-arena-name'

/**
 * Multiplayer: join/create a room, lobby, and the shared round loop.
 * The server is authoritative for everything (word, judging, scores, timer);
 * this page renders `room-state` snapshots and streams strokes. When I'm the
 * drawer, my client also hosts the AI's eyes: the same AiPlayer from
 * single-player watches my local strokes and submits its guesses over the
 * socket — the server judges them, so the AI can't cheat and neither can I.
 */
export default function Room() {
  const { code: codeFromUrl } = useParams()
  const socket = getSocket()

  const [playerId, setPlayerId] = useState<string | null>(null)
  const [room, setRoom] = useState<RoomState | null>(null)
  const [feed, setFeed] = useState<FeedEntry[]>([])
  const [prompt, setPrompt] = useState<string | null>(null)
  const [closeNudge, setCloseNudge] = useState<string | null>(null)
  const [gotIt, setGotIt] = useState(false)
  const [liveStrokes, setLiveStrokes] = useState<NormPoint[][]>([])
  const [clearToken, setClearToken] = useState(0)
  const [undoToken, setUndoToken] = useState(0)
  const [memoryHidden, setMemoryHidden] = useState(false)

  const storeRef = useRef(new StrokeStore())
  const senderRef = useRef<StrokeSender | null>(null)
  senderRef.current ??= new StrokeSender((ev) => getSocket().emit('stroke-event', ev))
  const canvasWrapRef = useRef<HTMLDivElement>(null)
  const aiRef = useRef<AiPlayer | null>(null)
  const lastEmitRef = useRef(0)
  const lastRoundRef = useRef(-1)
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const memoryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const modifierRef = useRef<ChaosModifier | null>(null)

  // --- socket lifecycle -------------------------------------------------------

  useEffect(() => {
    const s = getSocket()

    const onRoomState = (state: RoomState) => {
      if (state.phase.name === 'drawing' && state.phase.round.roundIndex !== lastRoundRef.current) {
        // new round housekeeping
        lastRoundRef.current = state.phase.round.roundIndex
        storeRef.current.clear()
        senderRef.current?.reset()
        setLiveStrokes([])
        setClearToken((n) => n + 1)
        setPrompt(null)
        setGotIt(false)
        setCloseNudge(null)
        if (memoryTimerRef.current) {
          clearTimeout(memoryTimerRef.current)
          memoryTimerRef.current = null
        }
        setMemoryHidden(false)
      }
      if (state.phase.name === 'lobby' || state.phase.name === 'match-end') {
        lastRoundRef.current = -1
      }
      setRoom(state)
    }
    const onFeed = (entry: FeedEntry) => {
      setFeed((prev) => [entry, ...prev].slice(0, 60))
      if (entry.kind === 'correct' && entry.playerId === s.id) setGotIt(true)
    }
    const onPrompt = (word: string) => setPrompt(word)
    const onStroke = (ev: StrokeEvent) => {
      storeRef.current.apply(ev)
      setLiveStrokes(storeRef.current.visibleStrokes())
    }
    const onSnapshot = (events: StrokeEvent[]) => {
      storeRef.current.clear()
      for (const ev of events) storeRef.current.apply(ev)
      setLiveStrokes(storeRef.current.visibleStrokes())
    }
    const onClose = (text: string) => {
      setCloseNudge(text)
      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current)
      nudgeTimerRef.current = setTimeout(() => setCloseNudge(null), 2500)
    }

    s.on('room-state', onRoomState)
    s.on('feed', onFeed)
    s.on('your-prompt', onPrompt)
    s.on('stroke-event', onStroke)
    s.on('canvas-snapshot', onSnapshot)
    s.on('close-guess', onClose)
    return () => {
      s.off('room-state', onRoomState)
      s.off('feed', onFeed)
      s.off('your-prompt', onPrompt)
      s.off('stroke-event', onStroke)
      s.off('canvas-snapshot', onSnapshot)
      s.off('close-guess', onClose)
      aiRef.current?.stop()
      s.disconnect() // leaving the page leaves the room
    }
  }, [])

  // --- derived ------------------------------------------------------------------

  const phase: RoomPhase | null = room?.phase ?? null
  const drawing = phase?.name === 'drawing' ? phase : null
  const roundEnd = phase?.name === 'round-end' ? phase : null
  const meta = drawing?.round ?? roundEnd?.round ?? null
  const isDrawer = meta !== null && meta.drawerId === playerId
  modifierRef.current = drawing?.round.modifier ?? null

  // --- drawer: stream strokes + host the AI's eyes -------------------------------

  const armMemoryTimer = useCallback((strokes: Stroke[]) => {
    if (modifierRef.current !== 'memory' || memoryTimerRef.current || strokes.length === 0) return
    memoryTimerRef.current = setTimeout(() => setMemoryHidden(true), MEMORY_HIDE_AFTER_MS)
  }, [])

  const flushStrokes = useCallback((strokes: Stroke[]) => {
    const canvas = canvasWrapRef.current?.querySelector('canvas')
    const size = canvas?.getBoundingClientRect().width
    if (size) senderRef.current?.update(strokes, size)
  }, [])

  const onStrokesChange = useCallback(
    (strokes: Stroke[]) => {
      armMemoryTimer(strokes)
      aiRef.current?.observe(strokes)
      flushStrokes(strokes) // stroke completed or undone — send now
      lastEmitRef.current = performance.now()
    },
    [armMemoryTimer, flushStrokes],
  )

  const onDrawingStrokes = useCallback(
    (strokes: Stroke[]) => {
      armMemoryTimer(strokes)
      aiRef.current?.observe(strokes)
      const now = performance.now()
      if (now - lastEmitRef.current < STROKE_EMIT_INTERVAL_MS) return
      lastEmitRef.current = now
      flushStrokes(strokes)
    },
    [armMemoryTimer, flushStrokes],
  )

  const drawingRoundKey = drawing ? drawing.round.roundIndex : -1

  // Ctrl+Z / Cmd+Z undoes my last stroke while I'm the drawer
  useEffect(() => {
    if (drawingRoundKey < 0 || !isDrawer) return
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        setUndoToken((n) => n + 1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [drawingRoundKey, isDrawer])

  useEffect(() => {
    if (drawingRoundKey < 0 || !isDrawer) return
    let cancelled = false
    let ai: AiPlayer | null = null
    void loadSharedGuesser().then((guesser) => {
      if (cancelled || !guesser) return
      ai = new AiPlayer({
        guesser,
        roundDurationMs: ROUND_DURATION_MS,
        onGuess: ({ category, confidence }) => getSocket().emit('ai-guess', category, confidence),
      })
      ai.startRound()
      aiRef.current = ai
    })
    return () => {
      cancelled = true
      ai?.stop()
      aiRef.current = null
    }
  }, [drawingRoundKey, isDrawer])

  // --- render --------------------------------------------------------------------

  if (!room || !playerId) {
    return (
      <JoinScreen
        initialCode={codeFromUrl ?? ''}
        onJoined={(id, state) => {
          setPlayerId(id)
          setRoom(state)
        }}
      />
    )
  }

  return (
    <main className="room">
      <header className="room-header">
        <Link to="/" className="hand-note room-back">
          ← home
        </Link>
        <span className="room-code" title="room code">
          {room.code}
        </span>
        <TeamStrip humans={room.teamHumans} ai={room.teamAi} />
      </header>

      {phase?.name === 'lobby' && (
        <Lobby
          room={room}
          meId={playerId}
          onStart={() => socket.emit('start-match')}
          onSetChaos={(l) => socket.emit('set-chaos', l)}
        />
      )}

      {(drawing || roundEnd) && meta && (
        <section className="room-arena">
          <div className="room-prompt-bar">
            {isDrawer && prompt ? (
              <div className="room-prompt">
                <span className="room-prompt-label">draw</span>
                <span className="room-prompt-word">{prompt}</span>
                <span className={`room-tier room-tier-${meta.tier}`}>{meta.tier}</span>
              </div>
            ) : (
              <div className="room-prompt">
                <span className="room-prompt-label">
                  {room.players.find((p) => p.id === meta.drawerId)?.name ?? '?'} draws
                </span>
                <span className="room-prompt-mask">{meta.mask}</span>
                <span className={`room-tier room-tier-${meta.tier}`}>{meta.tier}</span>
              </div>
            )}
            <div className="room-round-info">
              {meta.modifier && <ChaosBadge modifier={meta.modifier} />}
              <span className="room-round-count">
                round {meta.roundIndex + 1}/{meta.totalRounds}
              </span>
              {drawing && <Countdown endsAtMs={meta.endsAtMs} />}
            </div>
          </div>

          <div className="room-stage">
            <div className="room-canvas" ref={canvasWrapRef}>
              {isDrawer ? (
                <>
                  <DrawingCanvas
                    onStrokesChange={onStrokesChange}
                    onDrawing={onDrawingStrokes}
                    clearToken={clearToken}
                    undoToken={undoToken}
                    disabled={!drawing}
                    hideInk={memoryHidden}
                    transformPoint={transformFor(drawing?.round.modifier)}
                  />
                  {memoryHidden && drawing && (
                    <p className="hand-note room-memory-veil">
                      lights out — finish it from memory
                    </p>
                  )}
                  {drawing && (
                    <button
                      className="room-undo"
                      title="Undo last stroke (Ctrl+Z)"
                      onClick={() => setUndoToken((n) => n + 1)}
                    >
                      ↩ Undo
                    </button>
                  )}
                </>
              ) : (
                <LiveCanvas strokes={liveStrokes} />
              )}
              {drawing?.round.modifier && (
                <ChaosBanner modifier={drawing.round.modifier} roundKey={drawing.round.roundIndex} />
              )}
            </div>
            <div className="room-side">
              <Scoreboard room={room} meId={playerId} drawerId={meta.drawerId} />
              <ChatFeed
                entries={feed}
                meId={playerId}
                canGuess={!!drawing && !isDrawer && !gotIt}
                onGuess={(text) => socket.emit('guess', text)}
                closeNudge={closeNudge}
              />
            </div>
          </div>

          {roundEnd && (
            <RoundEndPanel
              reveal={roundEnd.reveal}
              nextAtMs={roundEnd.nextAtMs}
              isLast={meta.roundIndex + 1 >= meta.totalRounds}
              room={room}
            />
          )}
        </section>
      )}

      {phase?.name === 'match-end' && (
        <MatchEnd room={room} meId={playerId} onRestart={() => socket.emit('start-match')} />
      )}
    </main>
  )
}

// the drawer's AI needs the model exactly once per page lifetime
let guesserPromise: Promise<Guesser | null> | null = null
function loadSharedGuesser(): Promise<Guesser | null> {
  guesserPromise ??= Guesser.load().catch(() => {
    console.warn('AI guesser unavailable — no model exported yet')
    return null
  })
  return guesserPromise
}

// --- subcomponents -------------------------------------------------------------

function JoinScreen({
  initialCode,
  onJoined,
}: {
  initialCode: string
  onJoined: (playerId: string, state: RoomState) => void
}) {
  const [name, setName] = useState(() => localStorage.getItem(NAME_STORAGE_KEY) ?? '')
  const [code, setCode] = useState(initialCode)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const go = (mode: 'create' | 'join') => {
    const trimmed = name.trim()
    if (!trimmed) return setError('pick a name first')
    localStorage.setItem(NAME_STORAGE_KEY, trimmed)
    setBusy(true)
    setError(null)
    const s = getSocket()
    const ack = (res: JoinResult) => {
      setBusy(false)
      if (res.ok) onJoined(res.playerId, res.state)
      else setError(res.error)
    }
    if (mode === 'create') s.emit('create-room', trimmed, ack)
    else s.emit('join-room', code.trim().toUpperCase(), trimmed, ack)
  }

  const submitJoin = (e: FormEvent) => {
    e.preventDefault()
    if (code.trim()) go('join')
  }

  return (
    <main className="room room-join">
      <Link to="/" className="hand-note room-back">
        ← home
      </Link>
      <p className="hand-note room-join-kicker">grab your friends. the machine is waiting.</p>
      <h1>
        Play
        <br />
        Together
      </h1>
      <div className="room-join-card">
        <label className="room-field">
          <span className="room-field-label">your name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            placeholder="doodle master"
            autoFocus
          />
        </label>
        <button className="room-cta" disabled={busy} onClick={() => go('create')}>
          Create a room
        </button>
        <div className="room-join-divider hand-note">or join one</div>
        <form className="room-join-row" onSubmit={submitJoin}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={4}
            placeholder="CODE"
            className="room-code-input"
            aria-label="room code"
          />
          <button type="submit" disabled={busy || !code.trim()}>
            Join
          </button>
        </form>
        {error && <p className="room-error">{error}</p>}
      </div>
    </main>
  )
}

function Lobby({
  room,
  meId,
  onStart,
  onSetChaos,
}: {
  room: RoomState
  meId: string
  onStart: () => void
  onSetChaos: (l: ChaosLevel) => void
}) {
  const [copied, setCopied] = useState(false)
  const isHost = room.players.some((p) => p.id === meId && p.isHost)
  const humans = room.players.filter((p) => !p.isAi)

  const copyInvite = () => {
    void navigator.clipboard
      .writeText(`${location.origin}/rooms/${room.code}`)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => {})
  }

  return (
    <section className="room-lobby">
      <p className="hand-note">tell your friends the code, or send the link</p>
      <div className="room-lobby-code">
        <span className="room-lobby-code-value">{room.code}</span>
        <button onClick={copyInvite}>{copied ? 'Copied!' : 'Copy invite link'}</button>
      </div>
      <ul className="room-lobby-players">
        {room.players.map((p) => (
          <li key={p.id} className={p.isAi ? 'is-ai' : ''}>
            <span className="room-lobby-player-name">{p.name}</span>
            {p.isHost && <span className="room-lobby-tag">host</span>}
            {p.isAi && <span className="room-lobby-tag">always watching</span>}
            {p.id === meId && <span className="room-lobby-tag">you</span>}
          </li>
        ))}
      </ul>
      <div className="chaos-level" aria-label="chaos level">
        <span className="chaos-level-label">chaos:</span>
        {(['off', 'some', 'all'] as const).map((level) =>
          isHost ? (
            <button
              key={level}
              className={`chaos-level-btn${room.chaosLevel === level ? ' is-active' : ''}`}
              onClick={() => onSetChaos(level)}
            >
              {level}
            </button>
          ) : (
            room.chaosLevel === level && (
              <span key={level} className="chaos-level-readout">{level}</span>
            )
          ),
        )}
      </div>
      {isHost ? (
        <button className="room-cta" onClick={onStart}>
          Start match
        </button>
      ) : (
        <p className="hand-note">waiting for the host to start…</p>
      )}
      {humans.length === 1 && (
        <p className="hand-note room-lobby-solo">solo works too — it's you against the machine</p>
      )}
    </section>
  )
}

function TeamStrip({ humans, ai }: { humans: number; ai: number }) {
  return (
    <div className="room-teams" aria-label="humans versus AI score">
      <span className="room-teams-humans">humans {humans}</span>
      <span className="room-teams-vs">vs</span>
      <span className="room-teams-ai">{ai} AI</span>
    </div>
  )
}

function Scoreboard({
  room,
  meId,
  drawerId,
}: {
  room: RoomState
  meId: string
  drawerId: string | null
}) {
  const sorted = [...room.players].sort((a, b) => b.score - a.score)
  return (
    <ol className="room-scoreboard" aria-label="scoreboard">
      {sorted.map((p) => (
        <li key={p.id} className={p.isAi ? 'is-ai' : ''}>
          <span className="room-score-name">
            {p.id === drawerId && <span title="drawing">✏ </span>}
            {p.name}
            {p.id === meId ? ' (you)' : ''}
          </span>
          <span className="room-score-value">{p.score}</span>
        </li>
      ))}
    </ol>
  )
}

function Countdown({ endsAtMs }: { endsAtMs: number }) {
  const [left, setLeft] = useState(() => endsAtMs - Date.now())
  useEffect(() => {
    const interval = setInterval(() => setLeft(endsAtMs - Date.now()), 200)
    return () => clearInterval(interval)
  }, [endsAtMs])
  const seconds = Math.max(0, Math.ceil(left / 1000))
  return <span className={`room-timer${seconds <= 10 ? ' is-low' : ''}`}>{seconds}s</span>
}

function RoundEndPanel({
  reveal,
  nextAtMs,
  isLast,
  room,
}: {
  reveal: RoundReveal
  nextAtMs: number
  isLast: boolean
  room: RoomState
}) {
  const gains = room.players
    .map((p) => ({ ...p, gain: reveal.gains[p.id] ?? 0 }))
    .filter((p) => p.gain > 0)
    .sort((a, b) => b.gain - a.gain)
  const headline =
    reveal.reason === 'all-guessed'
      ? 'Everyone got it!'
      : reveal.reason === 'timeout'
        ? 'Time’s up'
        : 'The drawer left'
  return (
    <div className="room-panel" role="dialog" aria-label="round result">
      <h2>{headline}</h2>
      <p>
        The word was <strong>{reveal.word}</strong>
      </p>
      {gains.length > 0 ? (
        <ul className="room-panel-gains">
          {gains.map((p) => (
            <li key={p.id} className={p.isAi ? 'is-ai' : ''}>
              <span>{p.name}</span>
              <span>+{p.gain}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hand-note">nobody scored. brutal.</p>
      )}
      <p className="hand-note">
        {isLast ? 'final tally coming up…' : <NextIn nextAtMs={nextAtMs} />}
      </p>
    </div>
  )
}

function NextIn({ nextAtMs }: { nextAtMs: number }) {
  const [left, setLeft] = useState(() => nextAtMs - Date.now())
  useEffect(() => {
    const interval = setInterval(() => setLeft(nextAtMs - Date.now()), 250)
    return () => clearInterval(interval)
  }, [nextAtMs])
  return <>next round in {Math.max(0, Math.ceil(left / 1000))}…</>
}

function MatchEnd({
  room,
  meId,
  onRestart,
}: {
  room: RoomState
  meId: string
  onRestart: () => void
}) {
  const isHost = room.players.some((p) => p.id === meId && p.isHost)
  const humansWon = room.teamHumans > room.teamAi
  const tie = room.teamHumans === room.teamAi
  const sorted = [...room.players].sort((a, b) => b.score - a.score)
  return (
    <section className="room-summary">
      <p className="hand-note">final tally</p>
      <h1>
        {tie ? 'Dead heat' : humansWon ? 'Humans win' : 'The machine wins'}
      </h1>
      <p className="room-summary-teams">
        <span className="room-teams-humans">humans {room.teamHumans}</span>
        <span className="room-teams-vs">vs</span>
        <span className="room-teams-ai">{room.teamAi} AI</span>
      </p>
      <ol className="room-summary-players">
        {sorted.map((p) => (
          <li key={p.id} className={p.isAi ? 'is-ai' : ''}>
            <span>{p.name}</span>
            <span>{p.score}</span>
          </li>
        ))}
      </ol>
      {isHost ? (
        <button className="room-cta" onClick={onRestart}>
          Play again
        </button>
      ) : (
        <p className="hand-note">the host can start a rematch…</p>
      )}
    </section>
  )
}
