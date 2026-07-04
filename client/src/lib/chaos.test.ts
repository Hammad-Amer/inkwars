import { expect, test } from 'vitest'
import { mirrorPoint, transformFor } from './chaos'

test('mirrorPoint flips x across the canvas width', () => {
  expect(mirrorPoint({ x: 100, y: 50, t: 7 }, 460)).toEqual({ x: 360, y: 50, t: 7 })
})

test('transformFor maps modifiers to transforms', () => {
  expect(transformFor('mirror')).toBe(mirrorPoint)
  expect(transformFor(null)).toBeUndefined()
  expect(transformFor('memory')).toBeUndefined() // memory is a display effect, not a transform
})
