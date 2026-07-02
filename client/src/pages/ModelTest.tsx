import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import DrawingCanvas from '../components/DrawingCanvas'
import { Guesser, type Guess } from '../lib/guesser'
import { strokesToModelInput } from '../lib/preprocess'
import type { Stroke } from '../lib/strokes'
import './ModelTest.css'

const GUESS_THROTTLE_MS = 300

type LoadState = { status: 'loading' } | { status: 'missing' } | { status: 'ready'; guesser: Guesser }

/**
 * Phase 1 validation lab: draw anything, watch the model guess live.
 * This page exists to tune the training/preprocessing loop before any
 * game code is built on top of it.
 */
export default function ModelTest() {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [guesses, setGuesses] = useState<Guess[]>([])
  const [clearToken, setClearToken] = useState(0)
  const lastRunRef = useRef(0)
  const pendingRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    Guesser.load()
      .then((guesser) => {
        if (!cancelled) setLoad(guesser ? { status: 'ready', guesser } : { status: 'missing' })
      })
      .catch(() => {
        if (!cancelled) setLoad({ status: 'missing' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const runGuess = useCallback(
    async (strokes: Stroke[]) => {
      if (load.status !== 'ready') return
      const input = strokesToModelInput(strokes)
      if (!input) {
        setGuesses([])
        return
      }
      // guard against overlapping inference calls
      if (pendingRef.current) return
      pendingRef.current = true
      try {
        setGuesses(await load.guesser.guess(input))
      } finally {
        pendingRef.current = false
      }
    },
    [load],
  )

  const onDrawing = useCallback(
    (strokes: Stroke[]) => {
      const now = performance.now()
      if (now - lastRunRef.current < GUESS_THROTTLE_MS) return
      lastRunRef.current = now
      void runGuess(strokes)
    },
    [runGuess],
  )

  const onStrokesChange = useCallback((strokes: Stroke[]) => void runGuess(strokes), [runGuess])

  return (
    <main className="model-test">
      <header className="model-test-header">
        <Link to="/" className="model-test-back hand-note">
          ← back
        </Link>
        <h1>Model Test Lab</h1>
        <p className="hand-note">draw something — the AI guesses as you go</p>
      </header>

      {load.status === 'loading' && <p className="model-test-status">Loading model…</p>}

      {load.status === 'missing' && (
        <div className="model-test-missing">
          <h2>No model yet</h2>
          <p>
            The guesser hasn't been trained and exported. Run the pipeline in{' '}
            <code>training/</code> (see <code>training/README.md</code>):
          </p>
          <pre>
            python download_data.py{'\n'}python train.py{'\n'}python export_onnx.py
          </pre>
          <p>then reload this page.</p>
        </div>
      )}

      {load.status === 'ready' && (
        <div className="model-test-arena">
          <section className="model-test-canvas">
            <DrawingCanvas
              onStrokesChange={onStrokesChange}
              onDrawing={onDrawing}
              clearToken={clearToken}
            />
            <div className="model-test-actions">
              <button
                onClick={() => {
                  setClearToken((n) => n + 1)
                  setGuesses([])
                }}
              >
                Clear
              </button>
              <span className="model-test-meta">
                {load.guesser.manifest.categories.length} categories
                {load.guesser.manifest.valTop1 != null &&
                  ` · val top-1 ${(load.guesser.manifest.valTop1 * 100).toFixed(1)}%`}
              </span>
            </div>
          </section>

          <section className="model-test-guesses" aria-live="polite">
            <h2>AI thinks…</h2>
            {guesses.length === 0 && <p className="hand-note">the canvas is blank</p>}
            <ol>
              {guesses.map((g, i) => (
                <li key={g.category} className={i === 0 ? 'top-guess' : ''}>
                  <span className="guess-name">{g.category}</span>
                  <span className="guess-prob">{(g.probability * 100).toFixed(1)}%</span>
                  <span
                    className="guess-bar"
                    style={{ transform: `scaleX(${g.probability})` }}
                    aria-hidden="true"
                  />
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </main>
  )
}
