import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { MachineAnalysis, MachineQuip } from '../components/Commentary'
import DrawingCanvas from '../components/DrawingCanvas'
import GuessFeed, { type FeedEntry } from '../components/GuessFeed'
import { MEMORY_HIDE_AFTER_MS, type NormPoint } from '../../../shared/protocol'
import { ChaosBadge, ChaosBanner } from '../components/Chaos'
import ReplayCanvas from '../components/ReplayCanvas'
import { AiPlayer } from '../lib/aiPlayer'
import { matchRoast, roundQuip, type RoundFacts } from '../lib/commentary'
import { Guesser } from '../lib/guesser'
import { isCanvasModifier, rollCanvasModifier, transformFor, type CanvasChaosModifier } from '../lib/chaos'
import { pickMatchPrompts, TIER_POINTS, type Prompt } from '../lib/prompts'
import { normalizeStrokes } from '../lib/strokeWire'
import type { Stroke } from '../lib/strokes'
import './Play.css'

export const ROUND_DURATION_MS = 60_000
const ROUND_END_LINGER_MS = 900 // let the winning guess land before the panel

interface RoundResult {
  prompt: Prompt
  points: number
  /** null = time ran out */
  guessedAtMs: number | null
  /** normalized final drawing, for the replay */
  strokes: NormPoint[][]
  /** the AI's wrong guesses that round, for commentary */
  aiWrongGuesses: string[]
  modifier: CanvasChaosModifier | null
  /** THE MACHINE's round-end quip, chosen when the round closes */
  quip: string
}

type GamePhase =
  | { name: 'loading' }
  | { name: 'missing' }
  | { name: 'intro' }
  | { name: 'drawing'; roundIndex: number }
  | { name: 'round-end'; roundIndex: number }
  | { name: 'match-end' }

interface GameState {
  phase: GamePhase
  prompts: Prompt[]
  feed: FeedEntry[]
  results: RoundResult[]
}

type Action =
  | { type: 'model-loaded'; ok: boolean }
  | { type: 'start-match'; prompts: Prompt[] }
  | { type: 'start-round'; roundIndex: number }
  | { type: 'ai-guess'; entry: FeedEntry }
  | { type: 'end-round'; result: RoundResult }
  | { type: 'show-summary' }

function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'model-loaded':
      return { ...state, phase: { name: action.ok ? 'intro' : 'missing' } }
    case 'start-match':
      return { phase: { name: 'drawing', roundIndex: 0 }, prompts: action.prompts, feed: [], results: [] }
    case 'start-round':
      return { ...state, phase: { name: 'drawing', roundIndex: action.roundIndex }, feed: [] }
    case 'ai-guess':
      // ignore stragglers after the round closed
      if (state.phase.name !== 'drawing') return state
      return { ...state, feed: [action.entry, ...state.feed] }
    case 'end-round': {
      if (state.phase.name !== 'drawing') return state
      const roundIndex = state.phase.roundIndex
      const results = [...state.results, action.result]
      const phase: GamePhase =
        roundIndex + 1 >= state.prompts.length ? { name: 'match-end' } : { name: 'round-end', roundIndex }
      return { ...state, results, phase }
    }
    case 'show-summary':
      return { ...state, phase: { name: 'match-end' } }
  }
}

function factsFor(r: Omit<RoundResult, 'quip'>): RoundFacts {
  return {
    prompt: r.prompt.name,
    outcome: r.guessedAtMs === null ? 'unsolved' : 'ai',
    solveMs: r.guessedAtMs,
    roundDurationMs: ROUND_DURATION_MS,
    modifier: r.modifier,
    aiWrongGuesses: r.aiWrongGuesses,
  }
}

function scoreFor(prompt: Prompt, guessedAtMs: number): number {
  const timeLeftFraction = Math.max(0, 1 - guessedAtMs / ROUND_DURATION_MS)
  // even a buzzer-beater is worth something; speed multiplies the rest
  return Math.round((TIER_POINTS[prompt.tier] * (0.25 + 0.75 * timeLeftFraction)) / 5) * 5
}

/**
 * Phase 2: the single-player core loop. You draw the secret prompt; the AI
 * watches live and calls out guesses. It scores like skribbl's drawer role:
 * the faster the AI gets it, the more points your drawing earns.
 */
export default function Play() {
  const [state, dispatch] = useReducer(reducer, {
    phase: { name: 'loading' },
    prompts: [],
    feed: [],
    results: [],
  })
  const [clearToken, setClearToken] = useState(0)
  const [undoToken, setUndoToken] = useState(0)
  const [timeLeftMs, setTimeLeftMs] = useState(ROUND_DURATION_MS)
  const [chaosEnabled, setChaosEnabled] = useState(
    () => localStorage.getItem('drawing-arena-chaos') === '1',
  )
  const [modifier, setModifier] = useState<CanvasChaosModifier | null>(null)
  const [memoryHidden, setMemoryHidden] = useState(false)

  const guesserRef = useRef<Guesser | null>(null)
  const aiRef = useRef<AiPlayer | null>(null)
  const roundStartRef = useRef(0)
  const promptRef = useRef<Prompt | null>(null)
  const roundOpenRef = useRef(false)
  const feedIdRef = useRef(0)
  const aiWrongRef = useRef<string[]>([])
  const usedQuipIdsRef = useRef(new Set<string>())
  const chaosEnabledRef = useRef(chaosEnabled)
  chaosEnabledRef.current = chaosEnabled
  const modifierRef = useRef<CanvasChaosModifier | null>(null)
  const lastModRef = useRef<CanvasChaosModifier | null>(null)
  const memoryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestStrokesRef = useRef<Stroke[]>([])
  const playCanvasRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    Guesser.load()
      .then((guesser) => {
        if (cancelled) return
        guesserRef.current = guesser
        dispatch({ type: 'model-loaded', ok: guesser !== null })
      })
      .catch(() => !cancelled && dispatch({ type: 'model-loaded', ok: false }))
    return () => {
      cancelled = true
      aiRef.current?.stop()
    }
  }, [])

  const closeRound = useCallback((guessedAtMs: number | null) => {
    if (!roundOpenRef.current || !promptRef.current) return
    roundOpenRef.current = false
    aiRef.current?.stop()
    const prompt = promptRef.current
    const canvas = playCanvasRef.current?.querySelector('canvas')
    const size = canvas?.getBoundingClientRect().width ?? 0
    const base: Omit<RoundResult, 'quip'> = {
      prompt,
      guessedAtMs,
      points: guessedAtMs === null ? 0 : scoreFor(prompt, guessedAtMs),
      strokes: size ? normalizeStrokes(latestStrokesRef.current, size) : [],
      aiWrongGuesses: [...aiWrongRef.current],
      modifier: modifierRef.current,
    }
    const quip = roundQuip(factsFor(base), usedQuipIdsRef.current, (Math.random() * 2 ** 31) | 0)
    usedQuipIdsRef.current.add(quip.id)
    const result: RoundResult = { ...base, quip: quip.text }
    window.setTimeout(
      () => dispatch({ type: 'end-round', result }),
      guessedAtMs === null ? 0 : ROUND_END_LINGER_MS,
    )
  }, [])

  const startRound = useCallback(
    (roundIndex: number, prompts: Prompt[]) => {
      const guesser = guesserRef.current
      if (!guesser) return
      const forced = new URLSearchParams(window.location.search).get('chaos')
      const next = isCanvasModifier(forced)
        ? forced
        : chaosEnabledRef.current
          ? rollCanvasModifier(roundIndex, lastModRef.current)
          : null
      if (next) lastModRef.current = next
      modifierRef.current = next
      setModifier(next)
      setMemoryHidden(false)
      if (memoryTimerRef.current) {
        clearTimeout(memoryTimerRef.current)
        memoryTimerRef.current = null
      }
      promptRef.current = prompts[roundIndex]
      roundOpenRef.current = true
      roundStartRef.current = performance.now()
      setTimeLeftMs(ROUND_DURATION_MS)
      setClearToken((n) => n + 1)
      latestStrokesRef.current = []
      aiWrongRef.current = []

      aiRef.current?.stop()
      const ai = new AiPlayer({
        guesser,
        roundDurationMs: ROUND_DURATION_MS,
        onGuess: ({ category, confidence, atMs }) => {
          if (!roundOpenRef.current) return
          const correct = category === promptRef.current?.name
          if (!correct) aiWrongRef.current.push(category)
          dispatch({
            type: 'ai-guess',
            entry: { id: feedIdRef.current++, category, confidence, atMs, correct },
          })
          if (correct) closeRound(atMs)
        },
      })
      ai.startRound()
      aiRef.current = ai
    },
    [closeRound],
  )

  // round countdown
  const phaseName = state.phase.name

  // Ctrl+Z / Cmd+Z undoes the last stroke while drawing
  useEffect(() => {
    if (phaseName !== 'drawing') return
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        setUndoToken((n) => n + 1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [phaseName])

  useEffect(() => {
    if (phaseName !== 'drawing') return
    const interval = setInterval(() => {
      const left = ROUND_DURATION_MS - (performance.now() - roundStartRef.current)
      setTimeLeftMs(Math.max(0, left))
      if (left <= 0) closeRound(null)
    }, 200)
    return () => clearInterval(interval)
  }, [phaseName, closeRound])

  const onStrokes = useCallback((strokes: Stroke[]) => {
    latestStrokesRef.current = strokes
    if (
      modifierRef.current === 'memory' &&
      !memoryTimerRef.current &&
      strokes.length > 0
    ) {
      memoryTimerRef.current = setTimeout(() => setMemoryHidden(true), MEMORY_HIDE_AFTER_MS)
    }
    aiRef.current?.observe(strokes)
  }, [])

  const startMatch = () => {
    const guesser = guesserRef.current
    if (!guesser) return
    const prompts = pickMatchPrompts(guesser.manifest)
    usedQuipIdsRef.current.clear()
    dispatch({ type: 'start-match', prompts })
    startRound(0, prompts)
  }

  const nextRound = () => {
    if (state.phase.name !== 'round-end') return
    const roundIndex = state.phase.roundIndex + 1
    dispatch({ type: 'start-round', roundIndex })
    startRound(roundIndex, state.prompts)
  }

  const totalScore = state.results.reduce((sum, r) => sum + r.points, 0)
  const secondsLeft = Math.ceil(timeLeftMs / 1000)

  return (
    <main className="play">
      <header className="play-header">
        <Link to="/" className="hand-note play-back">
          ← home
        </Link>
        {state.phase.name !== 'loading' && state.phase.name !== 'missing' && (
          <div className="play-score" aria-label="total score">
            <span className="play-score-label">score</span>
            <span className="play-score-value" key={totalScore}>
              {totalScore}
            </span>
          </div>
        )}
      </header>

      {state.phase.name === 'loading' && <p className="play-status">Loading the AI…</p>}

      {state.phase.name === 'missing' && (
        <p className="play-status">
          No model exported yet — see <Link to="/model-test">the model test lab</Link> for setup.
        </p>
      )}

      {state.phase.name === 'intro' && (
        <section className="play-intro">
          <p className="hand-note play-intro-kicker">round one, you versus the machine's eyeballs</p>
          <h1>
            Draw it.
            <br />
            The AI guesses.
          </h1>
          <p className="play-intro-rules">
            Five rounds, sixty seconds each. You get a secret word; sketch it and the AI calls out
            guesses in real time. The faster it recognizes your drawing, the more points you score.
            Difficulty ramps up as you go.
          </p>
          <label className="play-chaos-toggle">
            <input
              type="checkbox"
              checked={chaosEnabled}
              onChange={(e) => {
                setChaosEnabled(e.target.checked)
                localStorage.setItem('drawing-arena-chaos', e.target.checked ? '1' : '0')
              }}
            />
            chaos rounds <span className="hand-note">(mirror · memory · shaky hands)</span>
          </label>
          <button className="play-cta" onClick={startMatch}>
            Start match
          </button>
        </section>
      )}

      {(state.phase.name === 'drawing' || state.phase.name === 'round-end') && (
        <section className="play-arena">
          <div className="play-prompt-bar">
            <div className="play-prompt">
              <span className="play-prompt-label">draw</span>
              <span className="play-prompt-word">{promptRef.current?.name}</span>
              <span className={`play-tier play-tier-${promptRef.current?.tier}`}>
                {promptRef.current?.tier}
              </span>
            </div>
            <div className="play-round-info">
              {modifier && <ChaosBadge modifier={modifier} />}
              <span className="play-round-count">
                round {(state.phase.name === 'drawing' ? state.phase.roundIndex : state.phase.roundIndex) + 1}/
                {state.prompts.length}
              </span>
              <span className={`play-timer${secondsLeft <= 10 ? ' is-low' : ''}`}>{secondsLeft}s</span>
            </div>
          </div>

          <div className="play-stage">
            <div className="play-canvas" ref={playCanvasRef}>
              <DrawingCanvas
                onStrokesChange={onStrokes}
                onDrawing={onStrokes}
                clearToken={clearToken}
                undoToken={undoToken}
                disabled={state.phase.name !== 'drawing'}
                transformPoint={transformFor(modifier)}
                hideInk={memoryHidden}
              />
              {state.phase.name === 'drawing' && (
                <div className="play-canvas-tools">
                  <button
                    className="play-undo"
                    title="Undo last stroke (Ctrl+Z)"
                    onClick={() => setUndoToken((n) => n + 1)}
                  >
                    ↩ Undo
                  </button>
                  <button className="play-giveup" onClick={() => closeRound(null)}>
                    Give up
                  </button>
                </div>
              )}
              {modifier && state.phase.name === 'drawing' && (
                <ChaosBanner
                  modifier={modifier}
                  roundKey={state.phase.roundIndex}
                />
              )}
              {memoryHidden && state.phase.name === 'drawing' && (
                <p className="hand-note play-memory-veil">lights out — finish it from memory</p>
              )}
            </div>
            <GuessFeed entries={state.feed} />
          </div>

          {state.phase.name === 'round-end' && (
            <RoundEndPanel result={state.results[state.results.length - 1]} onNext={nextRound} />
          )}
        </section>
      )}

      {state.phase.name === 'match-end' && (
        <MatchSummary results={state.results} total={totalScore} onRestart={startMatch} />
      )}
    </main>
  )
}

function RoundEndPanel({ result, onNext }: { result: RoundResult; onNext: () => void }) {
  const guessed = result.guessedAtMs !== null
  return (
    <div className="play-panel" role="dialog" aria-label="round result">
      <h2>{guessed ? 'It got it!' : 'Time’s up'}</h2>
      {result.strokes.length > 0 && (
        <div className="play-panel-replay">
          <ReplayCanvas strokes={result.strokes} />
        </div>
      )}
      <p>
        The word was <strong>{result.prompt.name}</strong>
        {guessed
          ? ` — guessed in ${(result.guessedAtMs! / 1000).toFixed(1)}s.`
          : ' — the AI never saw it.'}
      </p>
      <p className={`play-panel-points${guessed ? '' : ' is-zero'}`}>+{result.points} pts</p>
      <MachineQuip text={result.quip} />
      <button onClick={onNext}>Next round</button>
    </div>
  )
}

function MatchSummary({
  results,
  total,
  onRestart,
}: {
  results: RoundResult[]
  total: number
  onRestart: () => void
}) {
  const guessedCount = results.filter((r) => r.guessedAtMs !== null).length
  const [seed] = useState(() => (Math.random() * 2 ** 31) | 0)
  const analysis = useMemo(
    () => matchRoast({ mode: 'solo', rounds: results.map(factsFor), totalPoints: total }, seed),
    [results, total, seed],
  )
  return (
    <section className="play-summary">
      <p className="hand-note">final tally</p>
      <h1>{total} points</h1>
      <p className="play-summary-sub">
        The AI recognized {guessedCount} of {results.length} drawings.
      </p>
      <MachineAnalysis lines={analysis} />
      <ol className="play-recap">
        {results.map((r, i) => (
          <li key={i}>
            <figure className="replay-card">
              {r.strokes.length > 0 && <ReplayCanvas strokes={r.strokes} />}
              <figcaption>
                <span className="play-summary-word">{r.prompt.name}</span>
                <span className="play-summary-time hand-note">
                  {r.guessedAtMs === null ? 'missed' : `${(r.guessedAtMs / 1000).toFixed(1)}s`}
                </span>
                <span className="play-summary-points">+{r.points}</span>
              </figcaption>
            </figure>
          </li>
        ))}
      </ol>
      <button className="play-cta" onClick={onRestart}>
        Play again
      </button>
    </section>
  )
}
