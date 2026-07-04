import { describe, expect, test } from 'vitest'
import { rollModifier, scoreSimul } from './chaos.js'
import type { SimulEntry } from '../../shared/protocol.js'

const base = { level: 'all' as const, roundIndex: 3, humanCount: 3, last: null }
const pool: ('mirror' | 'memory' | 'jitter' | 'simul')[] = ['mirror', 'memory', 'jitter', 'simul']

describe('rollModifier', () => {
  test('off level never rolls', () => {
    expect(rollModifier({ ...base, level: 'off', pool, rng: () => 0 })).toBeNull()
  })
  test('round 1 is always clean', () => {
    expect(rollModifier({ ...base, roundIndex: 0, pool, rng: () => 0 })).toBeNull()
  })
  test('all level always rolls one from the pool', () => {
    expect(pool).toContain(rollModifier({ ...base, pool, rng: () => 0.99 }))
  })
  test('some level rolls only under the chance threshold', () => {
    expect(rollModifier({ ...base, level: 'some', pool, rng: () => 0.9 })).toBeNull()
    expect(rollModifier({ ...base, level: 'some', pool, rng: () => 0.1 })).not.toBeNull()
  })
  test('never repeats the previous modifier', () => {
    for (let i = 0; i < 40; i++) {
      expect(rollModifier({ ...base, last: 'mirror', pool })).not.toBe('mirror')
    }
  })
  test('simul needs at least 2 humans', () => {
    for (let i = 0; i < 40; i++) {
      expect(rollModifier({ ...base, humanCount: 1, pool })).not.toBe('simul')
    }
  })
  test('single-entry default pool skips a round rather than repeating', () => {
    // with ENABLED_MODIFIERS = ['mirror', 'memory', 'jitter'], excluding
    // 'mirror' leaves ['memory', 'jitter'], so a roll is still available. with
    // a true single-entry pool ['mirror'], excluding 'mirror' leaves nothing
    // and the round stays clean
    expect(rollModifier({ ...base, last: 'mirror', pool: ['mirror'], rng: () => 0 })).toBeNull()
    // verify that with the real pool, the first non-previous modifier rolls
    expect(rollModifier({ ...base, last: 'mirror', rng: () => 0 })).toBe('memory')
  })
  test('never repeats against the REAL default pool (mirror/memory/jitter/simul)', () => {
    // no `pool` override: this exercises ENABLED_MODIFIERS itself, now four
    // entries. for every possible previous modifier, sweep the rng across the
    // unit interval and require a roll that is never the previous one, always
    // one of the other enabled modifiers (simul included, since humanCount=2
    // satisfies its own >=2 requirement), and never null (alternatives always
    // remain at level 'all')
    const enabled = ['mirror', 'memory', 'jitter', 'simul'] as const
    for (const last of enabled) {
      const seen = new Set<string>()
      for (const r of [0, 0.2, 0.4, 0.6, 0.8, 0.99]) {
        const rolled = rollModifier({ level: 'all', roundIndex: 1, humanCount: 2, last, rng: () => r })
        expect(rolled).not.toBeNull()
        expect(rolled).not.toBe(last)
        expect(enabled.filter((m) => m !== last)).toContain(rolled)
        seen.add(rolled as string)
      }
      // all three remaining modifiers must actually be rollable — proves the
      // pool really has four entries, not fewer
      expect(seen.size).toBe(3)
    }
  })
})

const simulEntry = (playerId: string, aiTopGuess: string, aiConfidence: number): SimulEntry => ({
  playerId, name: playerId, strokes: [], aiTopGuess, aiConfidence,
})

describe('scoreSimul', () => {
  test('votes pay 60 each; AI pick bonus goes to the most-confident correct canvas', () => {
    const entries = [
      simulEntry('p1', 'duck', 0.9),
      simulEntry('p2', 'duck', 0.7),
      simulEntry('p3', 'cat', 0.99),
    ]
    const votes = new Map([['p2', 'p1'], ['p3', 'p1'], ['p1', 'p2']])
    const r = scoreSimul(entries, votes, 'duck')
    expect(r.gains.get('p1')).toBe(2 * 60 + 40) // two votes + AI pick
    expect(r.gains.get('p2')).toBe(60)
    expect(r.aiPickId).toBe('p1')
    expect(r.aiPoints).toBe(2 * 25) // it recognized two ducks
    expect(r.voteCounts.get('p1')).toBe(2)
  })
  test('AI-pick tie goes to the earlier submission', () => {
    const r = scoreSimul(
      [simulEntry('p1', 'duck', 0.8), simulEntry('p2', 'duck', 0.8)],
      new Map(),
      'duck',
    )
    expect(r.aiPickId).toBe('p1')
  })
  test('no correct canvases: no pick, no AI points', () => {
    const r = scoreSimul([simulEntry('p1', 'cat', 0.9)], new Map(), 'duck')
    expect(r.aiPickId).toBeNull()
    expect(r.aiPoints).toBe(0)
  })
})
