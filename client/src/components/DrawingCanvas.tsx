import { useEffect, useRef } from 'react'
import type { Stroke, StrokePoint } from '../lib/strokes'
import './DrawingCanvas.css'

interface DrawingCanvasProps {
  /** Called after every completed stroke and on clear, with all strokes so far. */
  onStrokesChange: (strokes: Stroke[]) => void
  /** Called continuously while a stroke is being drawn (throttled by the parent). */
  onDrawing?: (strokes: Stroke[]) => void
  /** Incrementing this prop clears the canvas. */
  clearToken?: number
  /** Incrementing this prop removes the most recent stroke. */
  undoToken?: number
  /** When true, pointer input is ignored (e.g. between rounds). */
  disabled?: boolean
  /** When true, points are recorded but nothing is painted (memory draw modifier). */
  hideInk?: boolean
  /** Optional transform applied to captured points before storing them. */
  transformPoint?: (p: StrokePoint, canvasSize: number) => StrokePoint
}

/**
 * Pointer-drawn canvas that records vector strokes (points + timestamps).
 * Rendering is fully imperative — React only manages mount/unmount — so
 * drawing stays smooth regardless of what the rest of the UI is doing.
 */
export default function DrawingCanvas({
  onStrokesChange,
  onDrawing,
  clearToken,
  undoToken,
  disabled = false,
  hideInk = false,
  transformPoint,
}: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const strokesRef = useRef<Stroke[]>([])
  const currentRef = useRef<Stroke | null>(null)
  const startTimeRef = useRef(0)
  const callbacksRef = useRef({ onStrokesChange, onDrawing })
  callbacksRef.current = { onStrokesChange, onDrawing }
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled
  const hideInkRef = useRef(hideInk)
  hideInkRef.current = hideInk
  const transformRef = useRef(transformPoint)
  transformRef.current = transformPoint

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || clearToken === undefined) return
    strokesRef.current = []
    currentRef.current = null
    startTimeRef.current = 0
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height)
    callbacksRef.current.onStrokesChange([])
  }, [clearToken])

  const repaintAll = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (hideInkRef.current) return // memory draw: keep recording, paint nothing
    const current = currentRef.current
    const toRedraw = current ? [...strokesRef.current, current] : strokesRef.current
    for (const stroke of toRedraw) {
      if (stroke.length === 0) continue
      ctx.beginPath()
      ctx.moveTo(stroke[0].x, stroke[0].y)
      for (const p of stroke) ctx.lineTo(p.x, p.y)
      if (stroke.length === 1) ctx.lineTo(stroke[0].x + 0.01, stroke[0].y)
      ctx.stroke()
    }
  }

  useEffect(() => {
    if (!undoToken || strokesRef.current.length === 0) return
    strokesRef.current = strokesRef.current.slice(0, -1)
    repaintAll()
    callbacksRef.current.onStrokesChange(strokesRef.current)
  }, [undoToken])

  useEffect(() => {
    hideInkRef.current = hideInk
    repaintAll() // hiding clears; unhiding (next round) restores
  }, [hideInk])

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    // Match the backing store to the CSS size once; the canvas is fixed-size.
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 3.5
    ctx.strokeStyle = '#141414'

    const toPoint = (e: PointerEvent): StrokePoint => {
      const r = canvas.getBoundingClientRect()
      if (startTimeRef.current === 0) startTimeRef.current = performance.now()
      const raw = {
        x: e.clientX - r.left,
        y: e.clientY - r.top,
        t: performance.now() - startTimeRef.current,
      }
      return transformRef.current ? transformRef.current(raw, r.width) : raw
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || disabledRef.current) return
      canvas.setPointerCapture(e.pointerId)
      const p = toPoint(e)
      currentRef.current = [p]
      if (!hideInkRef.current) {
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        // dot for a tap
        ctx.lineTo(p.x + 0.01, p.y)
        ctx.stroke()
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      const stroke = currentRef.current
      if (!stroke) return
      const p = toPoint(e)
      const prev = stroke[stroke.length - 1]
      stroke.push(p)
      if (!hideInkRef.current) {
        ctx.beginPath()
        ctx.moveTo(prev.x, prev.y)
        ctx.lineTo(p.x, p.y)
        ctx.stroke()
      }
      callbacksRef.current.onDrawing?.([...strokesRef.current, stroke])
    }

    const onPointerUp = () => {
      const stroke = currentRef.current
      if (!stroke) return
      currentRef.current = null
      strokesRef.current = [...strokesRef.current, stroke]
      callbacksRef.current.onStrokesChange(strokesRef.current)
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
    }
  }, [])

  return <canvas ref={canvasRef} className={`drawing-canvas${disabled ? ' is-disabled' : ''}`} />
}
