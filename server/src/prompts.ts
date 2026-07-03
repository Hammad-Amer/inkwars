import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { TIER_POINTS, type Tier } from '../../shared/protocol.js'

/**
 * Prompt source for multiplayer matches. The trained model's manifest is the
 * single source of truth for categories and difficulty tiers (the AI can only
 * ever guess words it knows), so the server reads the same manifest the
 * client's guesser loads. Override the path with MODEL_MANIFEST_PATH.
 */

export interface Prompt {
  name: string
  tier: Tier
}

const DEFAULT_MANIFEST_URL = new URL(
  '../../client/public/model/manifest.json',
  import.meta.url,
)

interface ManifestShape {
  categories: { name: string; tier: Tier }[]
}

let categories: Prompt[] | null = null

export function loadCategories(): Prompt[] {
  if (categories) return categories
  const path = process.env.MODEL_MANIFEST_PATH ?? fileURLToPath(DEFAULT_MANIFEST_URL)
  let manifest: ManifestShape
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(
      `Could not read the model manifest at ${path} — train/export the model first ` +
        `(see training/) or set MODEL_MANIFEST_PATH. (${String(err)})`,
    )
  }
  if (!Array.isArray(manifest.categories) || manifest.categories.length === 0) {
    throw new Error(`Model manifest at ${path} has no categories`)
  }
  categories = manifest.categories.map(({ name, tier }) => ({ name, tier }))
  return categories
}

/** Difficulty ramps across the match: first ~40% easy, next ~40% medium, rest hard. */
export function tierForRound(roundIndex: number, totalRounds: number): Tier {
  const progress = totalRounds <= 1 ? 1 : roundIndex / (totalRounds - 1)
  if (progress < 0.4) return 'easy'
  if (progress < 0.8) return 'medium'
  return 'hard'
}

export function pickMatchPrompts(totalRounds: number): Prompt[] {
  const all = loadCategories()
  const byTier: Record<Tier, Prompt[]> = { easy: [], medium: [], hard: [] }
  for (const c of all) byTier[c.tier].push(c)

  const used = new Set<string>()
  return Array.from({ length: totalRounds }, (_, i) => {
    const tier = tierForRound(i, totalRounds)
    // fall back to any tier if one is exhausted (tiny category lists)
    const pool = (byTier[tier].length ? byTier[tier] : all).filter((c) => !used.has(c.name))
    const pick = pool[Math.floor(Math.random() * pool.length)] ?? all[i % all.length]
    used.add(pick.name)
    return pick
  })
}

/** Speed scoring, same curve as single-player: even a buzzer-beater pays a bit. */
export function guessPoints(tier: Tier, atMs: number, roundDurationMs: number): number {
  const timeLeftFraction = Math.max(0, 1 - atMs / roundDurationMs)
  return Math.round((TIER_POINTS[tier] * (0.25 + 0.75 * timeLeftFraction)) / 5) * 5
}

/** The drawer earns a cut of every correct guess their drawing produced. */
export function drawerCut(points: number): number {
  return Math.round((points * 0.3) / 5) * 5
}
