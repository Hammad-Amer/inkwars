import {
  CHAOS_SOME_CHANCE,
  SIMUL_AI_PICK_BONUS,
  SIMUL_AI_RECOGNIZE_POINTS,
  SIMUL_VOTE_POINTS,
  type ChaosLevel,
  type ChaosModifier,
  type SimulEntry,
} from '../../shared/protocol.js'

/**
 * Chaos modifier selection. Pure so it's testable; the Room feeds it state
 * and applies the result. ENABLED_MODIFIERS grows one entry per Phase 4 task
 * so half-built modifiers never get rolled in a real round.
 */

const ALL_MODIFIERS: ChaosModifier[] = ['mirror', 'memory', 'jitter', 'simul']

export const ENABLED_MODIFIERS: ChaosModifier[] = ['mirror', 'memory', 'jitter', 'simul']

/** validates the CHAOS_FORCE env test hook */
export function isChaosModifier(v: unknown): v is ChaosModifier {
  return typeof v === 'string' && (ALL_MODIFIERS as string[]).includes(v)
}

export function rollModifier(opts: {
  level: ChaosLevel
  roundIndex: number
  humanCount: number
  last: ChaosModifier | null
  pool?: ChaosModifier[]
  rng?: () => number
}): ChaosModifier | null {
  const rng = opts.rng ?? Math.random
  // matches open readable: the first round is always a classic one
  if (opts.level === 'off' || opts.roundIndex === 0) return null
  if (opts.level === 'some' && rng() >= CHAOS_SOME_CHANCE) return null
  // a clean round beats a repeat: 'last' is excluded unconditionally, so a
  // single-entry pool skips a round rather than rolling the same modifier twice
  const pool = (opts.pool ?? ENABLED_MODIFIERS).filter(
    (m) => (m !== 'simul' || opts.humanCount >= 2) && m !== opts.last,
  )
  if (pool.length === 0) return null
  return pool[Math.floor(rng() * pool.length)]
}

export interface SimulScore {
  gains: Map<string, number>
  voteCounts: Map<string, number>
  aiPickId: string | null
  aiPoints: number
}

/** Pure simultaneous-mode scoring: human votes + the AI judge's verdicts. */
export function scoreSimul(
  entries: SimulEntry[],
  votes: Map<string, string>,
  word: string,
): SimulScore {
  const voteCounts = new Map<string, number>()
  for (const target of votes.values()) voteCounts.set(target, (voteCounts.get(target) ?? 0) + 1)
  const gains = new Map<string, number>()
  for (const [target, n] of voteCounts) gains.set(target, n * SIMUL_VOTE_POINTS)

  let aiPickId: string | null = null
  let bestConfidence = -1
  let recognized = 0
  for (const e of entries) {
    if (e.aiTopGuess !== word) continue
    recognized += 1
    // strict > keeps ties on the earlier submission
    if (e.aiConfidence > bestConfidence) {
      bestConfidence = e.aiConfidence
      aiPickId = e.playerId
    }
  }
  if (aiPickId) gains.set(aiPickId, (gains.get(aiPickId) ?? 0) + SIMUL_AI_PICK_BONUS)
  return { gains, voteCounts, aiPickId, aiPoints: recognized * SIMUL_AI_RECOGNIZE_POINTS }
}
