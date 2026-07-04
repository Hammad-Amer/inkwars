import { CHAOS_SOME_CHANCE, type ChaosLevel, type ChaosModifier } from '../../shared/protocol.js'

/**
 * Chaos modifier selection. Pure so it's testable; the Room feeds it state
 * and applies the result. ENABLED_MODIFIERS grows one entry per Phase 4 task
 * so half-built modifiers never get rolled in a real round.
 */

const ALL_MODIFIERS: ChaosModifier[] = ['mirror', 'memory', 'jitter', 'simul']

export const ENABLED_MODIFIERS: ChaosModifier[] = ['mirror']

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
  let pool = (opts.pool ?? ENABLED_MODIFIERS).filter((m) => m !== 'simul' || opts.humanCount >= 2)
  if (pool.length > 1) pool = pool.filter((m) => m !== opts.last)
  if (pool.length === 0) return null
  return pool[Math.floor(rng() * pool.length)]
}
