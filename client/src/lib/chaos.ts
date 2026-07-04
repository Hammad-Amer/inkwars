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

export function transformFor(
  modifier: ChaosModifier | null | undefined,
): PointTransform | undefined {
  if (modifier === 'mirror') return mirrorPoint
  return undefined
}
