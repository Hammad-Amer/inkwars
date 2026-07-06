import type { ChaosModifier } from '../../../shared/protocol'

/**
 * Phase 6-lite: THE MACHINE's voice. A pure, template-bank commentary engine —
 * no LLM, no network. Lines are condition-matched against real round/match
 * facts; the most specific eligible tier wins; selection is seeded and never
 * repeats a line id within a match (usedIds).
 */

export type RoundOutcome = 'ai' | 'human' | 'unsolved'

export interface RoundFacts {
  /** the revealed word */
  prompt: string
  /** who solved it first ('unsolved' = timeout or give-up) */
  outcome: RoundOutcome
  /** ms into the round of the first correct guess (null when unsolved) */
  solveMs: number | null
  roundDurationMs: number
  modifier: ChaosModifier | null
  /** THE MACHINE's wrong guesses that round, in order */
  aiWrongGuesses: string[]
  /** multiplayer: the human who got it first (when outcome === 'human') */
  solverName?: string
}

export type MatchFacts =
  | { mode: 'solo'; rounds: RoundFacts[]; totalPoints: number }
  | { mode: 'room'; rounds: RoundFacts[]; teamHumans: number; teamAi: number }

// --- seeded rng ---------------------------------------------------------------

/** mulberry32 — tiny deterministic PRNG so tests can pin selections */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const secs = (ms: number) => (ms / 1000).toFixed(1)

// --- round quips ----------------------------------------------------------------

interface QuipLine {
  id: string
  /** higher = more specific; the highest eligible tier always wins */
  tier: number
  when: (f: RoundFacts) => boolean
  render: (f: RoundFacts) => string
}

const ROUND_LINES: QuipLine[] = [
  // tier 3 — simul rounds have no single drawer; never fall through to drawing quips
  {
    id: 'simul-1',
    tier: 3,
    when: (f) => f.modifier === 'simul',
    render: (f) =>
      `Simultaneous "${f.prompt}" analysis complete. Several canvases. One correct opinion: mine.`,
  },
  {
    id: 'simul-2',
    tier: 3,
    when: (f) => f.modifier === 'simul',
    render: () => 'Everyone drew at once. I evaluated all of it. I remain unimpressed at scale.',
  },
  // tier 2 — specific
  {
    id: 'ai-fast',
    tier: 2,
    when: (f) => f.outcome === 'ai' && f.solveMs !== null && f.solveMs < 6000,
    render: (f) =>
      `"${f.prompt}" identified in ${secs(f.solveMs!)}s. Statistically, you have drawn this before.`,
  },
  {
    id: 'ai-buzzer',
    tier: 2,
    when: (f) => f.outcome === 'ai' && f.solveMs !== null && f.solveMs > f.roundDurationMs * 0.7,
    render: (f) => `"${f.prompt}" confirmed at the last possible moment. You made this difficult. Logged.`,
  },
  {
    id: 'ai-journey',
    tier: 2,
    when: (f) => f.outcome === 'ai' && f.aiWrongGuesses.length >= 3,
    render: (f) =>
      `Eventually: "${f.prompt}". My ${f.aiWrongGuesses.length} prior hypotheses included "${f.aiWrongGuesses[0]}". I stand by the journey.`,
  },
  {
    id: 'unsolved-blame',
    tier: 2,
    when: (f) => f.outcome === 'unsolved' && f.aiWrongGuesses.length >= 2,
    render: (f) =>
      `I offered "${f.aiWrongGuesses[0]}". I offered "${f.aiWrongGuesses[1]}". You were drawing "${f.prompt}". One of us is malfunctioning.`,
  },
  {
    id: 'unsolved-blank',
    tier: 2,
    when: (f) => f.outcome === 'unsolved' && f.aiWrongGuesses.length === 0,
    render: (f) =>
      `Zero viable hypotheses generated. The word was "${f.prompt}". This has been filed as your fault.`,
  },
  {
    id: 'human-first',
    tier: 2,
    when: (f) => f.outcome === 'human' && !!f.solverName,
    render: (f) => `${f.solverName} reached "${f.prompt}" before I did. Anomaly logged. Recalibrating.`,
  },
  {
    id: 'mirror',
    tier: 2,
    when: (f) => f.modifier === 'mirror',
    render: () =>
      'Mirror round. You struggled with left and right. I do not experience either. Advantage: machine.',
  },
  {
    id: 'memory',
    tier: 2,
    when: (f) => f.modifier === 'memory',
    render: (f) => `You finished "${f.prompt}" from memory. It showed.`,
  },
  {
    id: 'jitter',
    tier: 2,
    when: (f) => f.modifier === 'jitter',
    render: (f) => `Seismic interference detected. Your "${f.prompt}" survived. Barely.`,
  },
  // tier 1 — outcome-generic
  {
    id: 'ai-solved-1',
    tier: 1,
    when: (f) => f.outcome === 'ai',
    render: (f) => `"${f.prompt}" identified in ${secs(f.solveMs ?? 0)}s. Adequate.`,
  },
  {
    id: 'ai-solved-2',
    tier: 1,
    when: (f) => f.outcome === 'ai',
    render: (f) => `Recognition complete: "${f.prompt}". You may continue.`,
  },
  {
    id: 'human-solved-1',
    tier: 1,
    when: (f) => f.outcome === 'human',
    render: (f) =>
      `A human arrived at "${f.prompt}" first. Reviewing my priorities. Review complete: still superior.`,
  },
  {
    id: 'unsolved-1',
    tier: 1,
    when: (f) => f.outcome === 'unsolved',
    render: (f) => `Round terminated. "${f.prompt}" remains unverified. Disappointing for exactly one of us.`,
  },
  // tier 0 — always eligible, so the pool can never be empty
  { id: 'generic-1', tier: 0, when: () => true, render: () => 'Processing round. Conclusion: it happened.' },
  { id: 'generic-2', tier: 0, when: () => true, render: () => 'Data archived. Judgment reserved. Mostly.' },
]

export function roundQuip(f: RoundFacts, usedIds: Set<string>, seed: number): { id: string; text: string } {
  const eligible = ROUND_LINES.filter((l) => l.when(f))
  const fresh = eligible.filter((l) => !usedIds.has(l.id))
  const source = fresh.length > 0 ? fresh : eligible // all used → allow reuse
  const top = Math.max(...source.map((l) => l.tier))
  const pool = source.filter((l) => l.tier === top)
  const line = pool[Math.floor(mulberry32(seed)() * pool.length)]
  return { id: line.id, text: line.render(f) }
}

// --- match roast -----------------------------------------------------------------

const pick = (rand: () => number, variants: string[]) => variants[Math.floor(rand() * variants.length)]

function opener(m: MatchFacts, rand: () => number): string {
  if (m.mode === 'solo') {
    const n = m.rounds.length
    const k = m.rounds.filter((r) => r.outcome === 'ai').length
    if (k === n)
      return `Analysis complete: ${k} of ${n} drawings recognized. ${m.totalPoints} points. Your hands are legible. That is the highest compliment I issue.`
    if (k === 0)
      return `I recognized nothing. ${m.totalPoints} points. I would suggest lessons, but optimism is inefficient.`
    return pick(rand, [
      `${k} of ${n} drawings identified. ${m.totalPoints} points. A performance occurred.`,
      `Match parsed: ${k} of ${n} recognized, ${m.totalPoints} points. I have seen worse. Not often.`,
    ])
  }
  if (m.teamAi > m.teamHumans)
    return `Final score: machine ${m.teamAi}, humans ${m.teamHumans}. The outcome was never in doubt. It rarely is.`
  if (m.teamHumans > m.teamAi)
    return `Final score: humans ${m.teamHumans}, machine ${m.teamAi}. Enjoy it. Anomalies rarely repeat.`
  return `A tie at ${m.teamHumans}. Statistically the least satisfying outcome. Well done, I suppose.`
}

/** 0-2 lines about the match's most quotable facts, most interesting first */
function superlatives(m: MatchFacts): string[] {
  const out: string[] = []
  const confused = [...m.rounds]
    .filter((r) => r.aiWrongGuesses.length >= 2)
    .sort((a, b) => b.aiWrongGuesses.length - a.aiWrongGuesses.length)[0]
  if (confused)
    out.push(
      `"${confused.prompt}" required ${confused.aiWrongGuesses.length} failed hypotheses, including "${confused.aiWrongGuesses[0]}". I choose to blame the artist.`,
    )
  const solved = m.rounds.filter((r) => r.solveMs !== null)
  if (solved.length > 0) {
    const fastest = solved.reduce((a, b) => (a.solveMs! <= b.solveMs! ? a : b))
    out.push(
      `Fastest recognition: "${fastest.prompt}" in ${secs(fastest.solveMs!)}s. That drawing almost respected my time.`,
    )
  }
  const missed = m.rounds.filter((r) => r.outcome === 'unsolved' && r.modifier !== 'simul')
  if (missed.length > 0)
    out.push(`Unrecognized: ${missed.map((r) => `"${r.prompt}"`).join(', ')}. Filed under "abstract expressionism".`)
  const chaos = m.rounds.filter((r) => r.modifier !== null).length
  if (chaos >= 2) out.push(`${chaos} chaos rounds survived. The wobble was intentional. Mine, not yours.`)
  return out.slice(0, 2)
}

function closer(m: MatchFacts, rand: () => number): string {
  if (m.mode === 'solo')
    return pick(rand, [
      'Match archived. Return when your hands improve.',
      'Session closed. I will be here. I am always here.',
    ])
  if (m.teamAi > m.teamHumans) return 'Conclusion: the machine wins. This message was inevitable.'
  if (m.teamHumans > m.teamAi) return 'Fault logged. Recalibration scheduled. Enjoy this while it lasts.'
  return 'We settle this next match. Bring the same humans. I will bring more machine.'
}

export function matchRoast(m: MatchFacts, seed: number): string[] {
  const rand = mulberry32(seed)
  return [opener(m, rand), ...superlatives(m), closer(m, rand)]
}
