import { useEffect, useRef } from 'react'
import type { NormPoint } from '../../../shared/protocol'
import './DrawingCanvas.css'

/**
 * Read-only canvas for guessers: renders normalized (0..1) strokes streamed
 * from the drawer, scaled to whatever size this canvas happens to be.
 * Redraws whole on each change — cheap at doodle point counts, and it makes
 * undo and out-of-order batch arrival trivially correct.
 */
export default function LiveCanvas({ strokes }: { strokes: NormPoint[][] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sizeRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current!
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    sizeRef.current = rect.width
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const size = sizeRef.current
    if (!canvas || size === 0) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#141414'
    ctx.lineWidth = Math.max(2, size * 0.0076) // ~3.5px at the drawer's 460px
    for (const stroke of strokes) {
      if (stroke.length === 0) continue
      ctx.beginPath()
      ctx.moveTo(stroke[0].x * size, stroke[0].y * size)
      for (const p of stroke) ctx.lineTo(p.x * size, p.y * size)
      if (stroke.length === 1) ctx.lineTo(stroke[0].x * size + 0.01, stroke[0].y * size)
      ctx.stroke()
    }
  }, [strokes])

  return <canvas ref={canvasRef} className="drawing-canvas is-disabled" aria-label="live drawing" />
}
