import type { GuesserManifest, Tier } from './guesser'

/**
 * Prompt selection for a match. Difficulty ramps across the match:
 * early rounds pull easy categories, later rounds medium then hard.
 */

export interface Prompt {
  name: string
  tier: Tier
}

/** Tier of each round in a 5-round match. */
export const MATCH_TIERS: Tier[] = ['easy', 'easy', 'medium', 'medium', 'hard']

export const TIER_POINTS: Record<Tier, number> = { easy: 100, medium: 150, hard: 200 }

export function pickMatchPrompts(manifest: GuesserManifest): Prompt[] {
  const byTier: Record<Tier, Prompt[]> = { easy: [], medium: [], hard: [] }
  for (const c of manifest.categories) byTier[c.tier].push(c)

  const used = new Set<string>()
  return MATCH_TIERS.map((tier) => {
    // fall back to any tier if one is exhausted (tiny category lists)
    const pool = (byTier[tier].length ? byTier[tier] : manifest.categories).filter(
      (c) => !used.has(c.name),
    )
    const pick = pool[Math.floor(Math.random() * pool.length)]
    used.add(pick.name)
    return pick
  })
}
