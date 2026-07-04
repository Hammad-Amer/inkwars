import { expect, test } from 'vitest'
import { mirrorPoint, jitterPoint, transformFor } from './chaos'

test('mirrorPoint flips x across the canvas width', () => {
  expect(mirrorPoint({ x: 100, y: 50, t: 7 }, 460)).toEqual({ x: 360, y: 50, t: 7 })
})

test('transformFor maps modifiers to transforms', () => {
  expect(transformFor('mirror')).toBe(mirrorPoint)
  expect(transformFor(null)).toBeUndefined()
  expect(transformFor('memory')).toBeUndefined() // memory is a display effect, not a transform
})

test('jitter displacement is bounded', () => {
  for (let t = 0; t < 4000; t += 37) {
    const p = jitterPoint({ x: 200, y: 200, t }, 460)
    expect(Math.abs(p.x - 200)).toBeLessThan(460 * 0.012 * 1.5 + 1e-9)
    expect(Math.abs(p.y - 200)).toBeLessThan(460 * 0.012 * 1.5 + 1e-9)
  }
})

test('jitter drifts smoothly between adjacent samples', () => {
  for (let t = 0; t < 2000; t += 12) {
    const p1 = jitterPoint({ x: 200, y: 200, t }, 460)
    const p2 = jitterPoint({ x: 200, y: 200, t: t + 12 }, 460)
    expect(Math.hypot(p2.x - p1.x, p2.y - p1.y)).toBeLessThan(2.5)
  }
})

test('jitter actually moves the pen', () => {
  const spread = new Set<number>()
  for (let t = 0; t < 2000; t += 50) spread.add(Math.round(jitterPoint({ x: 200, y: 200, t }, 460).y))
  expect(spread.size).toBeGreaterThan(4)
})
