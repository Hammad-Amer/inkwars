import type { Stroke } from './strokes'

/**
 * Rasterize vector strokes into the model's input format, matching how the
 * Quick Draw numpy_bitmap dataset was produced (verified empirically against
 * the downloaded data): white ink on black, drawing bounding box scaled to
 * ~25/28 of the frame and centered, strokes ~1.3px wide at 28x28.
 *
 * We render supersampled at 8x (224x224) and let the canvas downscale to
 * 28x28 for anti-aliasing comparable to the dataset's.
 */

const SIZE = 28
const SS = 8 // supersampling factor
const RENDER = SIZE * SS
const TARGET_MAX_DIM = 25 * SS // dataset drawings span ~25 of 28 pixels
const LINE_WIDTH = 1.5 * SS // ~1.3-1.5px strokes at 28x28

export function strokesToModelInput(strokes: Stroke[]): Float32Array | null {
  const points = strokes.flat()
  if (points.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  const maxDim = Math.max(maxX - minX, maxY - minY)
  const scale = maxDim > 0 ? TARGET_MAX_DIM / maxDim : 1
  const offsetX = (RENDER - (maxX - minX) * scale) / 2
  const offsetY = (RENDER - (maxY - minY) * scale) / 2

  const big = new OffscreenCanvas(RENDER, RENDER)
  const bigCtx = big.getContext('2d')!
  bigCtx.fillStyle = '#000'
  bigCtx.fillRect(0, 0, RENDER, RENDER)
  bigCtx.strokeStyle = '#fff'
  bigCtx.lineWidth = LINE_WIDTH
  bigCtx.lineCap = 'round'
  bigCtx.lineJoin = 'round'
  for (const stroke of strokes) {
    if (stroke.length === 0) continue
    bigCtx.beginPath()
    bigCtx.moveTo((stroke[0].x - minX) * scale + offsetX, (stroke[0].y - minY) * scale + offsetY)
    for (const p of stroke) {
      bigCtx.lineTo((p.x - minX) * scale + offsetX, (p.y - minY) * scale + offsetY)
    }
    // a single tap should still leave a dot
    if (stroke.length === 1) {
      bigCtx.lineTo(
        (stroke[0].x - minX) * scale + offsetX + 0.01,
        (stroke[0].y - minY) * scale + offsetY,
      )
    }
    bigCtx.stroke()
  }

  const small = new OffscreenCanvas(SIZE, SIZE)
  const smallCtx = small.getContext('2d')!
  smallCtx.imageSmoothingEnabled = true
  smallCtx.imageSmoothingQuality = 'high'
  smallCtx.drawImage(big, 0, 0, SIZE, SIZE)

  const { data } = smallCtx.getImageData(0, 0, SIZE, SIZE)
  const input = new Float32Array(SIZE * SIZE)
  for (let i = 0; i < input.length; i++) {
    input[i] = data[i * 4] / 255 // red channel — grayscale, ink is white
  }
  return input
}
