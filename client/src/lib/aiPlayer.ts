import type { Guesser } from './guesser'
import { strokesToModelInput } from './preprocess'
import type { Stroke } from './strokes'

/**
 * The AI opponent as a player: watches the canvas and calls out guesses the
 * way a person would — it waits before its first shout, doesn't repeat
 * itself, spaces its guesses out, and takes wilder shots as the round timer
 * runs down (its confidence bar for speaking up decays over the round).
 *
 * The AI never knows the prompt; the game judges correctness. That keeps it
 * honest — it's genuinely reading the drawing.
 */

export interface AiGuessEvent {
  category: string
  /** model confidence at the moment of the guess, 0..1 */
  confidence: number
  /** ms since the round started */
  atMs: number
}

interface AiPlayerOptions {
  guesser: Guesser
  roundDurationMs: number
  onGuess: (event: AiGuessEvent) => void
}

// Tuning knobs for game feel — see PROGRESS.md open questions.
const INFER_INTERVAL_MS = 600 // how often the AI re-reads the canvas
const FIRST_GUESS_DELAY_MS = 3500 // no shouting before the drawing exists
const MIN_GUESS_GAP_MS = 1600 // pause between guesses
const GUESS_GAP_JITTER_MS = 1400 // + up to this much random hesitation
const START_THRESHOLD = 0.45 // confidence needed to speak up early on…
const END_THRESHOLD = 0.12 // …decaying to this by round end

export class AiPlayer {
  private readonly guesser: Guesser
  private readonly roundDurationMs: number
  private readonly onGuess: (event: AiGuessEvent) => void

  private startedAt = 0
  private latestStrokes: Stroke[] = []
  private saidCategories = new Set<string>()
  private nextAllowedGuessAt = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private inferring = false

  constructor(options: AiPlayerOptions) {
    this.guesser = options.guesser
    this.roundDurationMs = options.roundDurationMs
    this.onGuess = options.onGuess
  }

  startRound(): void {
    this.stop()
    this.startedAt = performance.now()
    this.latestStrokes = []
    this.saidCategories = new Set()
    this.nextAllowedGuessAt = this.startedAt + FIRST_GUESS_DELAY_MS
    this.timer = setInterval(() => void this.tick(), INFER_INTERVAL_MS)
  }

  observe(strokes: Stroke[]): void {
    this.latestStrokes = strokes
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async tick(): Promise<void> {
    if (this.inferring || this.latestStrokes.length === 0) return
    const now = performance.now()
    if (now < this.nextAllowedGuessAt) return

    const input = strokesToModelInput(this.latestStrokes)
    if (!input) return

    this.inferring = true
    try {
      const elapsed = now - this.startedAt
      const progress = Math.min(1, elapsed / this.roundDurationMs)
      const threshold = START_THRESHOLD + (END_THRESHOLD - START_THRESHOLD) * progress

      // consider the top few hypotheses, skipping ones already said
      const candidates = await this.guesser.guess(input, 3)
      const pick = candidates.find((c) => !this.saidCategories.has(c.category))
      if (!pick || pick.probability < threshold) return

      this.saidCategories.add(pick.category)
      this.nextAllowedGuessAt =
        performance.now() + MIN_GUESS_GAP_MS + Math.random() * GUESS_GAP_JITTER_MS
      this.onGuess({ category: pick.category, confidence: pick.probability, atMs: elapsed })
    } finally {
      this.inferring = false
    }
  }
}
