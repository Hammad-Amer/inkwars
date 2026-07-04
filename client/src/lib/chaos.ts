import { CHAOS_SOME_CHANCE } from '../../../shared/protocol'
import type { ChaosModifier } from '../../../shared/protocol'
import type { StrokePoint } from './strokes'

/**
 * Chaos modifier effects, applied at the drawer's input capture. Because the
 * transform happens before a point is recorded, everything downstream —
 * relay, AI observation, Phase 5 replays — just sees the actual drawing.
 */

export type PointTransform = (p: StrokePoint, canvasSize: number) => StrokePoint

/** mirror: your hand moves right, the ink lands left */
export function mirrorPoint(p: StrokePoint, canvasSize: number): StrokePoint {
  return { ...p, x: canvasSize - p.x }
}

/**
 * jitter: a smooth pseudo-random drift keyed by the point's timestamp — two
 * incommensurate sines per axis, so the wobble is continuous along a stroke
 * but never settles. Deterministic in t, which keeps it unit-testable.
 */
export function jitterPoint(p: StrokePoint, canvasSize: number): StrokePoint {
  const amp = canvasSize * 0.012 // ~5.5px on the 460px drawer canvas
  const dx = amp * (Math.sin(p.t / 173) + 0.5 * Math.sin(p.t / 59))
  const dy = amp * (Math.cos(p.t / 211) + 0.5 * Math.sin(p.t / 83))
  return { ...p, x: p.x + dx, y: p.y + dy }
}

export function transformFor(
  modifier: ChaosModifier | null | undefined,
): PointTransform | undefined {
  if (modifier === 'mirror') return mirrorPoint
  if (modifier === 'jitter') return jitterPoint
  return undefined
}

export const CANVAS_MODIFIERS = ['mirror', 'memory', 'jitter'] as const
export type CanvasChaosModifier = (typeof CANVAS_MODIFIERS)[number]

/** validates the ?chaos= URL test hook */
export function isCanvasModifier(v: unknown): v is CanvasChaosModifier {
  return typeof v === 'string' && (CANVAS_MODIFIERS as readonly string[]).includes(v)
}

/** /play's per-round roll — same odds as the multiplayer 'some' level */
export function rollCanvasModifier(
  roundIndex: number,
  last: CanvasChaosModifier | null,
  rng: () => number = Math.random,
): CanvasChaosModifier | null {
  if (roundIndex === 0) return null
  if (rng() >= CHAOS_SOME_CHANCE) return null
  const pool = CANVAS_MODIFIERS.filter((m) => m !== last)
  return pool[Math.floor(rng() * pool.length)]
}
