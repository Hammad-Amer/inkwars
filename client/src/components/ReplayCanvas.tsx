import { useEffect, useRef } from 'react'
import type { NormPoint } from '../../../shared/protocol'
import { buildReplayTimeline, REPLAY_DURATION_MS, REPLAY_LOOP_PAUSE_MS } from '../lib/replay'
import './ReplayCanvas.css'

/**
 * Auto-looping animated replay of a finished drawing. Takes raw normalized
 * strokes (the wire format), compresses their timeline, and redraws the
 * visible prefix every frame — the tip of the in-progress stroke is
 * interpolated inside its current segment so growth looks continuous at any
 * frame rate. Full redraw per frame is cheap at doodle point counts (same
 * philosophy as LiveCanvas).
 */
export default function ReplayCanvas({
  strokes,
  durationMs = REPLAY_DURATION_MS,
}: {
  strokes: NormPoint[][]
  durationMs?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    const size = rect.width
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)

    const timeline = buildReplayTimeline(strokes, durationMs)
    const cycleMs = durationMs + REPLAY_LOOP_PAUSE_MS
    const startedAt = performance.now()
    let raf = 0

    const drawAt = (elapsed: number) => {
      ctx.clearRect(0, 0, size, size)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = '#141414'
      ctx.lineWidth = Math.max(2, size * 0.0076)
      for (const stroke of timeline) {
        if (stroke[0].t > elapsed) break // strokes start in timeline order
        ctx.beginPath()
        ctx.moveTo(stroke[0].x * size, stroke[0].y * size)
        let tip = 0
        for (let i = 1; i < stroke.length; i++) {
          const p = stroke[i]
          if (p.t <= elapsed) {
            ctx.lineTo(p.x * size, p.y * size)
            tip = i
          } else {
            const prev = stroke[i - 1]
            const span = p.t - prev.t
            const f = span <= 0 ? 1 : (elapsed - prev.t) / span
            ctx.lineTo((prev.x + (p.x - prev.x) * f) * size, (prev.y + (p.y - prev.y) * f) * size)
            tip = i
            break
          }
        }
        if (tip === 0) ctx.lineTo(stroke[0].x * size + 0.01, stroke[0].y * size) // lone dot
        ctx.stroke()
      }
    }

    // reduced motion: show the finished drawing, skip the animation loop
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      drawAt(durationMs)
      return
    }

    const frame = () => {
      // past durationMs the finished drawing holds until the loop restarts
      drawAt(Math.min((performance.now() - startedAt) % cycleMs, durationMs))
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [strokes, durationMs])

  return <canvas ref={canvasRef} className="replay-canvas" aria-label="drawing replay" />
}
