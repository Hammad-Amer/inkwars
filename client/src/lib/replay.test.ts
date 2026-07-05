import { expect, test } from 'vitest'
import { buildReplayTimeline, REPLAY_GAP_CAP_MS } from './replay'
import type { NormPoint } from '../../../shared/protocol'

const pt = (t: number): NormPoint => ({ x: 0.5, y: 0.5, t })

test('empty input stays empty', () => {
  expect(buildReplayTimeline([], 4000)).toEqual([])
  expect(buildReplayTimeline([[]], 4000)).toEqual([])
})

test('single dot and zero-time-span drawings land entirely at t=0', () => {
  expect(buildReplayTimeline([[pt(1234)]], 4000)[0][0].t).toBe(0)
  const out = buildReplayTimeline([[pt(500), pt(500)]], 4000)
  expect(out[0].map((p) => p.t)).toEqual([0, 0])
})

test('timeline spans exactly durationMs and starts at 0', () => {
  const out = buildReplayTimeline([[pt(0), pt(100)], [pt(9000), pt(9500)]], 4000)
  expect(out[0][0].t).toBe(0)
  expect(out[1][1].t).toBe(4000)
})

test('inter-stroke gaps are capped, intra-stroke rhythm preserved', () => {
  // stroke 1 takes 300ms; a 20s thinking pause; stroke 2 takes 300ms.
  // compressed raw timeline: 300 + 400 (capped gap) + 300 = 1000 → scale ×4
  const out = buildReplayTimeline(
    [[pt(0), pt(100), pt(300)], [pt(20_300), pt(20_600)]],
    4000,
  )
  expect(REPLAY_GAP_CAP_MS).toBe(400)
  expect(out[0].map((p) => p.t)).toEqual([0, 400, 1200])
  expect(out[1].map((p) => p.t)).toEqual([2800, 4000])
})

test('timestamps are non-decreasing even for disordered raw data', () => {
  const out = buildReplayTimeline(
    [[pt(0), pt(100), pt(50)], [pt(40), pt(90)], [pt(5000), pt(5001)]],
    4000,
  )
  const flat = out.flat().map((p) => p.t)
  for (let i = 1; i < flat.length; i++) expect(flat[i]).toBeGreaterThanOrEqual(flat[i - 1])
})
