import { describe, expect, test } from 'vitest'
import { rollModifier } from './chaos.js'

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
  test('never repeats against the REAL default pool (mirror/memory/jitter)', () => {
    // no `pool` override: this exercises ENABLED_MODIFIERS itself. for every
    // possible previous modifier, sweep the rng across the unit interval and
    // require a roll that is never the previous one, never 'simul' (not
    // enabled), and never null (two alternatives always remain at level 'all')
    const enabled = ['mirror', 'memory', 'jitter'] as const
    for (const last of enabled) {
      const seen = new Set<string>()
      for (const r of [0, 0.25, 0.5, 0.75, 0.99]) {
        const rolled = rollModifier({ level: 'all', roundIndex: 1, humanCount: 2, last, rng: () => r })
        expect(rolled).not.toBeNull()
        expect(rolled).not.toBe(last)
        expect(enabled.filter((m) => m !== last)).toContain(rolled)
        seen.add(rolled as string)
      }
      // both remaining modifiers must actually be rollable — proves the pool
      // really has three entries, not two
      expect(seen.size).toBe(2)
    }
  })
})
