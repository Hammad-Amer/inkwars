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
})
