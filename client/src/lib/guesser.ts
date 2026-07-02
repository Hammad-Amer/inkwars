import * as ort from 'onnxruntime-web/wasm'
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'

/**
 * The AI guesser: loads the trained Quick Draw model (exported by
 * training/export_onnx.py into /model/) and classifies 28x28 drawings.
 * Runs fully client-side on the ORT WASM backend — the model is tiny, so
 * inference is sub-millisecond and needs no GPU.
 */

ort.env.wasm.wasmPaths = { wasm: ortWasmUrl }

export type Tier = 'easy' | 'medium' | 'hard'

export interface GuesserManifest {
  modelFile: string
  inputSize: number
  categories: { name: string; tier: Tier }[]
  valTop1: number | null
  valTop5: number | null
  exportedAt: string
}

export interface Guess {
  category: string
  probability: number
}

export class Guesser {
  readonly manifest: GuesserManifest
  private readonly session: ort.InferenceSession

  private constructor(manifest: GuesserManifest, session: ort.InferenceSession) {
    this.manifest = manifest
    this.session = session
  }

  /** Returns null if no model has been exported yet (pre-training state). */
  static async load(): Promise<Guesser | null> {
    const res = await fetch('/model/manifest.json')
    // Vite's SPA fallback serves index.html for unknown paths, so also check
    // the content type rather than trusting a 200 alone.
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null
    const manifest: GuesserManifest = await res.json()
    const session = await ort.InferenceSession.create(`/model/${manifest.modelFile}`)
    return new Guesser(manifest, session)
  }

  async guess(input: Float32Array, topK = 5): Promise<Guess[]> {
    const size = this.manifest.inputSize
    const tensor = new ort.Tensor('float32', input, [1, 1, size, size])
    const { logits } = await this.session.run({ drawing: tensor })
    const scores = softmax(logits.data as Float32Array)
    return scores
      .map((probability, i) => ({ category: this.manifest.categories[i].name, probability }))
      .sort((a, b) => b.probability - a.probability)
      .slice(0, topK)
  }
}

function softmax(logits: Float32Array): number[] {
  const max = Math.max(...logits)
  const exps = Array.from(logits, (v) => Math.exp(v - max))
  const sum = exps.reduce((a, b) => a + b, 0)
  return exps.map((v) => v / sum)
}
