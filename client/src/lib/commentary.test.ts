import { describe, expect, it } from 'vitest'
import { matchRoast, roundQuip, type MatchFacts, type RoundFacts } from './commentary'

const base: RoundFacts = {
  prompt: 'sun',
  outcome: 'ai',
  solveMs: 5000,
  roundDurationMs: 60_000,
  modifier: null,
  aiWrongGuesses: [],
}

const round = (over: Partial<RoundFacts>): RoundFacts => ({ ...base, ...over })

describe('roundQuip', () => {
  it('is deterministic for the same facts and seed', () => {
    expect(roundQuip(base, new Set(), 42)).toEqual(roundQuip(base, new Set(), 42))
  })

  it('prefers the most specific tier: unsolved with no guesses hits the blank-round line', () => {
    const q = roundQuip(round({ outcome: 'unsolved', solveMs: null }), new Set(), 1)
    expect(q.id).toBe('unsolved-blank')
    expect(q.text).toContain('sun')
  })

  it('skips used ids and falls back a tier', () => {
    const f = round({ outcome: 'unsolved', solveMs: null })
    const q = roundQuip(f, new Set(['unsolved-blank']), 1)
    expect(q.id).not.toBe('unsolved-blank')
  })

  it('still answers when every line has been used', () => {
    const used = new Set<string>()
    const f = round({ outcome: 'unsolved', solveMs: null })
    for (let i = 0; i < 40; i++) used.add(roundQuip(f, used, i).id)
    expect(roundQuip(f, used, 99).text.length).toBeGreaterThan(0)
  })

  it('simul rounds always get a simul quip', () => {
    const q = roundQuip(round({ modifier: 'simul' }), new Set(), 7)
    expect(q.id.startsWith('simul')).toBe(true)
  })

  it('fills wrong-guess slots', () => {
    const q = roundQuip(
      round({ outcome: 'unsolved', solveMs: null, aiWrongGuesses: ['broccoli', 'spider'] }),
      new Set(),
      3,
    )
    expect(q.id).toBe('unsolved-blame')
    expect(q.text).toContain('broccoli')
    expect(q.text).toContain('spider')
  })

  it('names the human who beat it', () => {
    const q = roundQuip(round({ outcome: 'human', solverName: 'ayesha' }), new Set(), 5)
    expect(q.text).toContain('ayesha')
  })
})

describe('matchRoast', () => {
  const soloMatch: MatchFacts = {
    mode: 'solo',
    totalPoints: 310,
    rounds: [
      base,
      round({
        prompt: 'cat',
        outcome: 'unsolved',
        solveMs: null,
        aiWrongGuesses: ['broccoli', 'lion', 'dog', 'tiger'],
      }),
      round({ prompt: 'house', solveMs: 3000 }),
    ],
  }

  it('is deterministic and 2-4 lines', () => {
    const lines = matchRoast(soloMatch, 11)
    expect(lines).toEqual(matchRoast(soloMatch, 11))
    expect(lines.length).toBeGreaterThanOrEqual(2)
    expect(lines.length).toBeLessThanOrEqual(4)
  })

  it('mentions the total points in the solo opener', () => {
    expect(matchRoast(soloMatch, 11)[0]).toContain('310')
  })

  it('surfaces the most-confused round in a superlative line', () => {
    expect(matchRoast(soloMatch, 11).join(' ')).toContain('broccoli')
  })

  it('gloats when team AI wins a room match', () => {
    const m: MatchFacts = { mode: 'room', rounds: [base], teamHumans: 100, teamAi: 400 }
    expect(matchRoast(m, 2).join(' ')).toContain('inevitable')
  })

  it('logs a fault when the humans win', () => {
    const m: MatchFacts = { mode: 'room', rounds: [base], teamHumans: 400, teamAi: 100 }
    expect(matchRoast(m, 2).join(' ')).toContain('Fault logged')
  })
})
