import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
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
  type SimulEntry,
  type StrokeEvent,
} from '../../../shared/protocol'
import { ChaosBadge, ChaosBanner } from '../components/Chaos'
import ChatFeed from '../components/ChatFeed'
import { MachineAnalysis, MachineQuip } from '../components/Commentary'
import DrawingCanvas from '../components/DrawingCanvas'
import LiveCanvas from '../components/LiveCanvas'
import ReplayCanvas from '../components/ReplayCanvas'
import { AiPlayer } from '../lib/aiPlayer'
import { matchRoast, roundQuip, type RoundFacts } from '../lib/commentary'
import { Guesser } from '../lib/guesser'
import { transformFor } from '../lib/chaos'
import { strokesToModelInput } from '../lib/preprocess'
import { getSocket } from '../lib/socket'
import { normalizeStrokes, StrokeSender, StrokeStore } from '../lib/strokeWire'
import type { Stroke } from '../lib/strokes'
import './Room.css'

const STROKE_EMIT_INTERVAL_MS = 50 // mid-stroke batching; stroke ends flush immediately
const NAME_STORAGE_KEY = 'drawing-arena-name'

/** one finished round's drawing, kept client-side for replays (Phase 5) */
interface ArchivedRound {
  roundIndex: number
  word: string
  drawerName: string
  strokes: NormPoint[][]
}

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
  const [quip, setQuip] = useState<string | null>(null)

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
  const drawingRef = useRef<Extract<RoomPhase, { name: 'drawing' }> | null>(null)
  const simulStrokesRef = useRef<Stroke[]>([])
  const simulSubmittedRef = useRef(false)
  // joined mid-simul-round: spectate it (the server ignores late submissions anyway)
  const spectatingRoundRef = useRef(-1)
  const archiveRef = useRef(new Map<number, ArchivedRound>())
  const aiWrongRef = useRef<string[]>([])
  const firstCorrectRef = useRef<{ isAi: boolean; name: string; atMs: number } | null>(null)
  const factsRef = useRef(new Map<number, RoundFacts>())
  const usedQuipIdsRef = useRef(new Set<string>())
  const drawerStrokesRef = useRef<Stroke[]>([])
  const galleryRef = useRef<SimulEntry[]>([])

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
        drawerStrokesRef.current = []
        aiWrongRef.current = []
        firstCorrectRef.current = null
        setQuip(null)
        if (state.phase.round.roundIndex === 0) {
          archiveRef.current.clear() // new match
          factsRef.current.clear()
          usedQuipIdsRef.current.clear()
        }
      }
      if (state.phase.name === 'lobby' || state.phase.name === 'match-end') {
        lastRoundRef.current = -1
      }
      if (state.phase.name === 'simul-vote') galleryRef.current = state.phase.gallery
      if (state.phase.name === 'round-end' && !factsRef.current.has(state.phase.round.roundIndex)) {
        // Phase 6: freeze this round's commentary facts and pick the quip once
        const { round, reveal } = state.phase
        const first = firstCorrectRef.current
        const facts: RoundFacts = {
          prompt: reveal.word,
          outcome:
            round.modifier === 'simul' || first === null ? 'unsolved' : first.isAi ? 'ai' : 'human',
          solveMs: round.modifier === 'simul' ? null : (first?.atMs ?? null),
          roundDurationMs: ROUND_DURATION_MS,
          modifier: round.modifier,
          aiWrongGuesses: [...aiWrongRef.current],
          solverName: first && !first.isAi ? first.name : undefined,
        }
        factsRef.current.set(round.roundIndex, facts)
        const q = roundQuip(facts, usedQuipIdsRef.current, (Math.random() * 2 ** 31) | 0)
        usedQuipIdsRef.current.add(q.id)
        setQuip(q.text)
      }
      if (state.phase.name === 'round-end' && !archiveRef.current.has(state.phase.round.roundIndex)) {
        const { round, reveal } = state.phase
        if (round.modifier === 'simul') {
          // the recap keeps the round's vote winner (tie → earliest gallery entry)
          const gallery = galleryRef.current
          if (gallery.length > 0) {
            const votes = reveal.simulVotes ?? {}
            let winner = gallery[0]
            for (const e of gallery) {
              if ((votes[e.playerId] ?? 0) > (votes[winner.playerId] ?? 0)) winner = e
            }
            archiveRef.current.set(round.roundIndex, {
              roundIndex: round.roundIndex,
              word: reveal.word,
              drawerName: winner.name,
              strokes: winner.strokes,
            })
          }
          galleryRef.current = []
        } else {
          // drawer holds the original px strokes; everyone else has the relayed vectors
          let strokes: NormPoint[][] = []
          if (round.drawerId === s.id) {
            const size = canvasWrapRef.current?.querySelector('canvas')?.getBoundingClientRect().width ?? 0
            if (size) strokes = normalizeStrokes(drawerStrokesRef.current, size)
          } else {
            strokes = storeRef.current.visibleStrokes()
          }
          if (strokes.length > 0) {
            archiveRef.current.set(round.roundIndex, {
              roundIndex: round.roundIndex,
              word: reveal.word,
              drawerName: state.players.find((p) => p.id === round.drawerId)?.name ?? '?',
              strokes,
            })
          }
        }
      }
      setRoom(state)
    }
    const onFeed = (entry: FeedEntry) => {
      setFeed((prev) => [entry, ...prev].slice(0, 60))
      if (entry.kind === 'guess' && entry.isAi) aiWrongRef.current.push(entry.text)
      if (entry.kind === 'correct' && firstCorrectRef.current === null)
        firstCorrectRef.current = { isAi: entry.isAi, name: entry.name, atMs: entry.atMs }
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
  const simulVote = phase?.name === 'simul-vote' ? phase : null
  const meta = drawing?.round ?? roundEnd?.round ?? simulVote?.round ?? null
  const isDrawer = meta !== null && meta.drawerId === playerId
  const isSimul = meta?.modifier === 'simul'
  modifierRef.current = drawing?.round.modifier ?? null
  drawingRef.current = drawing

  // --- drawer: stream strokes + host the AI's eyes -------------------------------

  const armMemoryTimer = useCallback((strokes: Stroke[]) => {
    if (modifierRef.current !== 'memory' || memoryTimerRef.current || strokes.length === 0) return
    memoryTimerRef.current = setTimeout(() => setMemoryHidden(true), MEMORY_HIDE_AFTER_MS)
  }, [])

  const flushStrokes = useCallback((strokes: Stroke[]) => {
    if (modifierRef.current === 'simul') return
    const canvas = canvasWrapRef.current?.querySelector('canvas')
    const size = canvas?.getBoundingClientRect().width
    if (size) senderRef.current?.update(strokes, size)
  }, [])

  const onStrokesChange = useCallback(
    (strokes: Stroke[]) => {
      drawerStrokesRef.current = strokes
      armMemoryTimer(strokes)
      aiRef.current?.observe(strokes)
      flushStrokes(strokes) // stroke completed or undone — send now
      lastEmitRef.current = performance.now()
    },
    [armMemoryTimer, flushStrokes],
  )

  const onDrawingStrokes = useCallback(
    (strokes: Stroke[]) => {
      drawerStrokesRef.current = strokes
      armMemoryTimer(strokes)
      aiRef.current?.observe(strokes)
      const now = performance.now()
      if (now - lastEmitRef.current < STROKE_EMIT_INTERVAL_MS) return
      lastEmitRef.current = now
      flushStrokes(strokes)
    },
    [armMemoryTimer, flushStrokes],
  )

  const onSimulStrokes = useCallback((strokes: Stroke[]) => {
    simulStrokesRef.current = strokes // private: nothing leaves this tab until the deadline
  }, [])

  const submitSimul = useCallback(async () => {
    const canvas = canvasWrapRef.current?.querySelector('canvas')
    const size = canvas?.getBoundingClientRect().width ?? 0
    const strokes = simulStrokesRef.current
    let topGuess = ''
    let confidence = 0
    const guesser = await loadSharedGuesser()
    const input = guesser && strokes.length > 0 ? strokesToModelInput(strokes) : null
    if (guesser && input) {
      const [best] = await guesser.guess(input, 1)
      if (best) {
        topGuess = best.category
        confidence = best.probability
      }
    }
    getSocket().emit('simul-submit', size ? normalizeStrokes(strokes, size) : [], topGuess, confidence)
  }, [])

  const drawingRoundKey = drawing ? drawing.round.roundIndex : -1

  // Ctrl+Z / Cmd+Z undoes my last stroke while I'm the drawer
  useEffect(() => {
    if (drawingRoundKey < 0 || (!isDrawer && !isSimul)) return
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        setUndoToken((n) => n + 1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [drawingRoundKey, isDrawer, isSimul])

  useEffect(() => {
    if (drawingRoundKey < 0 || !isDrawer || drawing?.round.modifier === 'simul') return
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
  }, [drawingRoundKey, isDrawer, drawing?.round.modifier])

  // simultaneous mode: draw privately, submit (with my AI's verdict) at the deadline.
  // Reads drawingRef/spectatingRoundRef instead of closing over `drawing` directly so the
  // effect body has no reactive deps beyond drawingRoundKey (see the deps comment below) —
  // `drawing` is a fresh object on every room-state broadcast (score updates etc.) and would
  // otherwise force this to re-run mid-round, resetting the submitted flag.
  useEffect(() => {
    const round = drawingRef.current
    if (drawingRoundKey < 0 || !round || round.round.modifier !== 'simul') return
    if (spectatingRoundRef.current === round.round.roundIndex) return
    simulSubmittedRef.current = false
    simulStrokesRef.current = []
    void loadSharedGuesser() // warm the model before the verdict is due
    const endsAt = round.round.endsAtMs
    const interval = setInterval(() => {
      if (simulSubmittedRef.current || Date.now() < endsAt) return
      simulSubmittedRef.current = true
      clearInterval(interval)
      void submitSimul()
    }, 200)
    return () => clearInterval(interval)
    // deps: drawingRoundKey (+ the stable submitSimul callback) — it changes exactly once per
    // round, and re-running on every room-state (scores) would reset the submitted flag mid-round
  }, [drawingRoundKey, submitSimul])

  // --- render --------------------------------------------------------------------

  if (!room || !playerId) {
    return (
      <JoinScreen
        initialCode={codeFromUrl ?? ''}
        onJoined={(id, state) => {
          setPlayerId(id)
          setRoom(state)
          if (state.phase.name === 'drawing' && state.phase.round.modifier === 'simul') {
            spectatingRoundRef.current = state.phase.round.roundIndex
          }
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

      {(drawing || roundEnd || simulVote) && meta && (
        <section className="room-arena">
          <div className="room-prompt-bar">
            {(isDrawer || isSimul) && prompt ? (
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
              {(drawing || simulVote) && (
                <Countdown endsAtMs={simulVote ? simulVote.votesEndAtMs : meta.endsAtMs} />
              )}
            </div>
          </div>

          <div className="room-stage">
            {simulVote ? (
              <SimulGallery
                gallery={simulVote.gallery}
                meId={playerId}
                votesEndAtMs={simulVote.votesEndAtMs}
                onVote={(id) => socket.emit('simul-vote', id)}
              />
            ) : (
              <div className="room-canvas" ref={canvasWrapRef}>
                {isSimul && drawing && spectatingRoundRef.current === drawing.round.roundIndex ? (
                  <p className="hand-note room-simul-spectate">
                    everyone's mid-drawing — you're in from the next round
                  </p>
                ) : isDrawer || (isSimul && drawing) ? (
                  <>
                    <DrawingCanvas
                      onStrokesChange={isSimul ? onSimulStrokes : onStrokesChange}
                      onDrawing={isSimul ? onSimulStrokes : onDrawingStrokes}
                      clearToken={clearToken}
                      undoToken={undoToken}
                      disabled={!drawing}
                      hideInk={isSimul ? false : memoryHidden}
                      transformPoint={isSimul ? undefined : transformFor(drawing?.round.modifier)}
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
                ) : simulVote ? null : (
                  <LiveCanvas strokes={liveStrokes} />
                )}
                {drawing?.round.modifier && (
                  <ChaosBanner modifier={drawing.round.modifier} roundKey={drawing.round.roundIndex} />
                )}
              </div>
            )}
            <div className="room-side">
              <Scoreboard room={room} meId={playerId} drawerId={meta.drawerId} />
              <ChatFeed
                entries={feed}
                meId={playerId}
                canGuess={!!drawing && !isDrawer && !gotIt && !isSimul}
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
              replay={archiveRef.current.get(roundEnd.round.roundIndex)?.strokes ?? null}
              quip={quip}
            />
          )}
        </section>
      )}

      {phase?.name === 'match-end' && (
        <MatchEnd
          room={room}
          meId={playerId}
          onRestart={() => socket.emit('start-match')}
          recap={[...archiveRef.current.values()].sort((a, b) => a.roundIndex - b.roundIndex)}
          facts={[...factsRef.current.entries()].sort((a, b) => a[0] - b[0]).map(([, f]) => f)}
        />
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
  replay,
  quip,
}: {
  reveal: RoundReveal
  nextAtMs: number
  isLast: boolean
  room: RoomState
  replay: NormPoint[][] | null
  quip: string | null
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
        : reveal.reason === 'simul-done'
          ? 'The votes are in'
          : 'The drawer left'
  return (
    <div className="room-panel" role="dialog" aria-label="round result">
      <h2>{headline}</h2>
      <p>
        The word was <strong>{reveal.word}</strong>
      </p>
      {replay && replay.length > 0 && (
        <div className="room-panel-replay">
          <ReplayCanvas strokes={replay} />
        </div>
      )}
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
      {quip && <MachineQuip text={quip} />}
      {reveal.aiPickId && (
        <p className="hand-note">
          THE MACHINE backed {room.players.find((p) => p.id === reveal.aiPickId)?.name ?? '?'} (+40)
        </p>
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
  recap,
  facts,
}: {
  room: RoomState
  meId: string
  onRestart: () => void
  recap: ArchivedRound[]
  facts: RoundFacts[]
}) {
  const isHost = room.players.some((p) => p.id === meId && p.isHost)
  const humansWon = room.teamHumans > room.teamAi
  const tie = room.teamHumans === room.teamAi
  const sorted = [...room.players].sort((a, b) => b.score - a.score)
  const [seed] = useState(() => (Math.random() * 2 ** 31) | 0)
  const analysis = useMemo(
    () =>
      facts.length === 0
        ? []
        : matchRoast(
            { mode: 'room', rounds: facts, teamHumans: room.teamHumans, teamAi: room.teamAi },
            seed,
          ),
    [facts, room.teamHumans, room.teamAi, seed],
  )
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
      <MachineAnalysis lines={analysis} />
      {recap.length > 0 && (
        <ol className="room-recap" aria-label="round replays">
          {recap.map((r) => (
            <li key={r.roundIndex}>
              <figure className="replay-card">
                <ReplayCanvas strokes={r.strokes} />
                <figcaption>
                  <span>{r.word}</span>
                  <span className="hand-note">{r.drawerName}</span>
                </figcaption>
              </figure>
            </li>
          ))}
        </ol>
      )}
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

function SimulGallery({
  gallery,
  meId,
  votesEndAtMs,
  onVote,
}: {
  gallery: SimulEntry[]
  meId: string
  votesEndAtMs: number
  onVote: (playerId: string) => void
}) {
  const [votedFor, setVotedFor] = useState<string | null>(null)
  void votesEndAtMs // countdown lives in the prompt bar
  return (
    <div className="simul-gallery">
      <p className="hand-note simul-gallery-title">vote for the best one (not yours, obviously)</p>
      <div className="simul-grid">
        {gallery.map((e) => (
          <figure key={e.playerId} className="simul-entry">
            <LiveCanvas strokes={e.strokes} />
            <figcaption>
              {e.name}
              {e.playerId === meId ? ' (you)' : ''}
            </figcaption>
            <button
              className="simul-vote-btn"
              disabled={e.playerId === meId || votedFor !== null}
              onClick={() => {
                setVotedFor(e.playerId)
                onVote(e.playerId)
              }}
            >
              {votedFor === e.playerId ? 'Voted ✓' : 'Vote'}
            </button>
          </figure>
        ))}
      </div>
    </div>
  )
}
