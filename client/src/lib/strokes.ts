/**
 * Vector stroke types — the canonical drawing representation across the app.
 * Strokes are stored as point sequences (never pixels), which is what the
 * replay system (Phase 5) and network sync (Phase 3) are built on.
 */

export interface StrokePoint {
  x: number
  y: number
  /** milliseconds since the drawing started — used for replays */
  t: number
}

export type Stroke = StrokePoint[]
