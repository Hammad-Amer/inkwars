import type { Guesser } from './guesser'
import { strokesToModelInput } from './preprocess'
import type { Stroke } from './strokes'

/**
 * The AI opponent as a player: watches the canvas and calls out guesses the
 * way a person would. Three human behaviors shape it:
 *
 * 1. It needs something to look at — it won't react until there's enough ink
 *    on the canvas to plausibly "see" anything (a dot or one line isn't it).
 * 2. It commits, not scans — the same idea must stay its top pick across
 *    several consecutive reads of the canvas before it speaks up. The model
 *    is near-instantly confident (100 known classes, trained on doodles just
 *    like yours), so raw confidence alone would make it inhumanly fast.
 * 3. It blurts near-misses — when its second-best idea is close behind, it
 *    sometimes calls that out first ("clock! …no, compass!") before landing
 *    on the real answer a beat later.
 *
 * As the round timer runs down it loosens up: the confidence bar decays and
 * it needs less deliberation, so it takes wilder shots late.
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
const FIRST_GUESS_DELAY_MS = 4500 // no shouting before the drawing exists
const MIN_GUESS_GAP_MS = 1600 // pause between guesses
const GUESS_GAP_JITTER_MS = 1400 // + up to this much random hesitation
const START_THRESHOLD = 0.55 // confidence needed to speak up early on…
const END_THRESHOLD = 0.12 // …decaying to this by round end
const STABLE_READS_EARLY = 4 // consecutive agreeing reads to commit, early on…
const STABLE_READS_LATE = 2 // …relaxing to this by round end
const NEAR_MISS_MARGIN = 0.35 // #2 this close behind #1 can get blurted first
const NEAR_MISS_CHANCE = 0.45 // …with this probability
const MAX_NEAR_MISSES = 2 // per round; more reads as trolling
// "enough ink to look at": ≥ this many points, drawing ≥ this big, and total
// pen travel ≥ this multiple of the drawing's size (one straight line = 1.0)
const MIN_INK_POINTS = 8
const MIN_INK_DIM_PX = 40
const MIN_INK_TRAVEL_RATIO = 1.6

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
  private streakCategory: string | null = null
  private streakCount = 0
  private nearMisses = 0

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
    this.nextAllowedGuessAt = 0
    this.streakCategory = null
    this.streakCount = 0
    this.nearMisses = 0
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
    if (this.inferring || !hasEnoughInk(this.latestStrokes)) return

    const input = strokesToModelInput(this.latestStrokes)
    if (!input) return

    this.inferring = true
    try {
      const now = performance.now()
      const elapsed = now - this.startedAt
      const progress = Math.min(1, elapsed / this.roundDurationMs)
      const threshold = START_THRESHOLD + (END_THRESHOLD - START_THRESHOLD) * progress
      const requiredStreak = Math.round(
        STABLE_READS_EARLY + (STABLE_READS_LATE - STABLE_READS_EARLY) * progress,
      )

      // consider the top few hypotheses, skipping ones already said
      const candidates = await this.guesser.guess(input, 4)
      const unsaid = candidates.filter((c) => !this.saidCategories.has(c.category))
      const pick = unsaid[0]
      if (!pick) return

      // build conviction: the same idea has to hold up across reads
      if (pick.category !== this.streakCategory) {
        this.streakCategory = pick.category
        this.streakCount = 0
      }
      if (pick.probability < threshold) return // not sure enough yet — keep watching
      this.streakCount += 1

      if (this.streakCount < requiredStreak) return
      if (elapsed < FIRST_GUESS_DELAY_MS || now < this.nextAllowedGuessAt) return

      // sometimes blurt the close runner-up first, like a person thinking out loud
      const runnerUp = unsaid[1]
      const canNearMiss =
        runnerUp !== undefined &&
        this.nearMisses < MAX_NEAR_MISSES &&
        pick.probability - runnerUp.probability < NEAR_MISS_MARGIN
      if (canNearMiss && Math.random() < NEAR_MISS_CHANCE) {
        this.nearMisses += 1
        this.say(runnerUp.category, runnerUp.probability, elapsed)
        // conviction about the real pick keeps building; it lands next gap
      } else {
        this.say(pick.category, pick.probability, elapsed)
      }
    } finally {
      this.inferring = false
    }
  }

  private say(category: string, confidence: number, atMs: number): void {
    this.saidCategories.add(category)
    this.nextAllowedGuessAt =
      performance.now() + MIN_GUESS_GAP_MS + Math.random() * GUESS_GAP_JITTER_MS
    this.onGuess({ category, confidence, atMs })
  }
}

/** True once the drawing is substantial enough that a watcher would react. */
function hasEnoughInk(strokes: Stroke[]): boolean {
  let points = 0
  let travel = 0
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const stroke of strokes) {
    points += stroke.length
    for (let i = 0; i < stroke.length; i++) {
      const p = stroke[i]
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
      if (i > 0) travel += Math.hypot(p.x - stroke[i - 1].x, p.y - stroke[i - 1].y)
    }
  }
  if (points < MIN_INK_POINTS) return false
  const maxDim = Math.max(maxX - minX, maxY - minY)
  if (maxDim < MIN_INK_DIM_PX) return false
  return travel / maxDim >= MIN_INK_TRAVEL_RATIO
}
