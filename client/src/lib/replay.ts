import type { NormPoint } from '../../../shared/protocol'

/**
 * Replay timeline compression (Phase 5). Raw stroke timestamps record how a
 * drawing was really made — including 20-second thinking pauses. A replay
 * keeps the pen's rhythm inside each stroke but caps the dead air between
 * strokes, then scales the whole thing to a fixed clip length.
 */

export const REPLAY_DURATION_MS = 4000
export const REPLAY_LOOP_PAUSE_MS = 700
export const REPLAY_GAP_CAP_MS = 400

export function buildReplayTimeline(
  strokes: NormPoint[][],
  durationMs = REPLAY_DURATION_MS,
): NormPoint[][] {
  const drawn = strokes.filter((s) => s.length > 0)
  if (drawn.length === 0) return []

  // pass 1: compressed (unscaled) timeline — per-stroke point offsets survive,
  // inter-stroke gaps get capped
  let cursor = 0
  let prevEndRaw: number | null = null
  const compressed = drawn.map((stroke) => {
    const startRaw = stroke[0].t
    if (prevEndRaw !== null) {
      cursor += Math.min(Math.max(0, startRaw - prevEndRaw), REPLAY_GAP_CAP_MS)
    }
    const base = cursor
    const out = stroke.map((p) => ({ ...p, t: base + Math.max(0, p.t - startRaw) }))
    // defensive: the wire sanitizer preserves order but never proves it
    for (let i = 1; i < out.length; i++) if (out[i].t < out[i - 1].t) out[i].t = out[i - 1].t
    cursor = out[out.length - 1].t
    prevEndRaw = stroke[stroke.length - 1].t
    return out
  })

  // pass 2: scale so the last point lands exactly on durationMs
  if (cursor <= 0) return compressed.map((s) => s.map((p) => ({ ...p, t: 0 })))
  const scale = durationMs / cursor
  return compressed.map((s) => s.map((p) => ({ ...p, t: p.t * scale })))
}
