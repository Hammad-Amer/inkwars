import type { NormPoint, StrokeEvent } from '../../../shared/protocol'
import type { Stroke } from './strokes'

/**
 * Vector stroke sync (see shared/protocol.ts for the wire design).
 *
 * StrokeSender diffs the drawer's full stroke arrays (as DrawingCanvas
 * reports them, in canvas px) into incremental events with normalized 0..1
 * coordinates: begin / points-batches keyed by (strokeId, seq) / undo.
 *
 * StrokeStore is the receiving half: it places point batches by sequence
 * slot, so duplicated or out-of-order delivery still assembles the right
 * polyline, and undo works whenever it arrives. Rendering reads only the
 * contiguous prefix of each stroke's batches.
 */

export class StrokeSender {
  private ids: number[] = [] // wire id per local stroke index
  private sentPoints: number[] = [] // points already sent per local stroke index
  private nextSeq = new Map<number, number>()
  private nextId = 1
  private readonly emit: (ev: StrokeEvent) => void

  constructor(emit: (ev: StrokeEvent) => void) {
    this.emit = emit
  }

  reset(): void {
    this.ids = []
    this.sentPoints = []
    this.nextSeq.clear()
  }

  /** Diff the latest stroke list against what's been sent; canvasSize in px. */
  update(strokes: Stroke[], canvasSize: number): void {
    // fewer strokes than before = undo
    while (this.ids.length > strokes.length) {
      const id = this.ids.pop()!
      this.sentPoints.pop()
      this.nextSeq.delete(id)
      this.emit({ type: 'undo', strokeId: id })
    }
    const norm = (p: Stroke[number]): NormPoint => ({
      x: p.x / canvasSize,
      y: p.y / canvasSize,
      t: p.t,
    })
    for (let i = 0; i < strokes.length; i++) {
      const stroke = strokes[i]
      if (stroke.length === 0) continue
      if (i >= this.ids.length) {
        const id = this.nextId++
        this.ids.push(id)
        this.sentPoints.push(1)
        this.nextSeq.set(id, 0)
        this.emit({ type: 'begin', strokeId: id, point: norm(stroke[0]) })
      }
      const id = this.ids[i]
      const sent = this.sentPoints[i]
      if (stroke.length > sent) {
        const seq = this.nextSeq.get(id) ?? 0
        this.nextSeq.set(id, seq + 1)
        this.emit({ type: 'points', strokeId: id, seq, points: stroke.slice(sent).map(norm) })
        this.sentPoints[i] = stroke.length
      }
    }
  }
}

/** Full-drawing normalization for one-shot payloads (simultaneous mode). */
export function normalizeStrokes(strokes: Stroke[], canvasSize: number): NormPoint[][] {
  return strokes.map((s) => s.map((p) => ({ x: p.x / canvasSize, y: p.y / canvasSize, t: p.t })))
}

interface StoredStroke {
  begin: NormPoint | null
  chunks: Map<number, NormPoint[]> // by seq
  undone: boolean
}

export class StrokeStore {
  private strokes = new Map<number, StoredStroke>()
  private order: number[] = []

  clear(): void {
    this.strokes.clear()
    this.order = []
  }

  apply(ev: StrokeEvent): void {
    if (ev.type === 'begin') {
      this.entry(ev.strokeId).begin = ev.point
    } else if (ev.type === 'points') {
      this.entry(ev.strokeId).chunks.set(ev.seq, ev.points)
    } else {
      this.entry(ev.strokeId).undone = true
    }
  }

  private entry(id: number): StoredStroke {
    let s = this.strokes.get(id)
    if (!s) {
      s = { begin: null, chunks: new Map(), undone: false }
      this.strokes.set(id, s)
      this.order.push(id)
    }
    return s
  }

  /** Assembled visible strokes, normalized 0..1, in draw order. */
  visibleStrokes(): NormPoint[][] {
    const out: NormPoint[][] = []
    for (const id of this.order) {
      const s = this.strokes.get(id)!
      if (s.undone || !s.begin) continue
      const points = [s.begin]
      // contiguous prefix only — a gap means a batch is still in flight
      for (let seq = 0; s.chunks.has(seq); seq++) points.push(...s.chunks.get(seq)!)
      out.push(points)
    }
    return out
  }
}
