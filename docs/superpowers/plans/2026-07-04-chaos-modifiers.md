# Phase 4 — Chaos Modifiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four chaos modifiers (mirror, memory draw, jitter, simultaneous mode) in multiplayer rooms, with the three canvas modifiers also on `/play` — per the approved spec at `docs/superpowers/specs/2026-07-04-chaos-modifiers-design.md`.

**Architecture:** The server rolls a modifier per round (host-set chaos level) and stamps it into `RoundMeta`; mirror/jitter transform pen points at input capture on the drawer's client (so relayed/AI-seen/replayed strokes are just the real drawing), memory only hides the drawer's local display. Simul is a distinct round flow: private drawing → submissions with each client's own AI verdict → gallery vote.

**Tech Stack:** Existing React 19 + TS + Vite client, Express 5 + Socket.io server, `shared/protocol.ts` contract. New: vitest (unit tests, both packages), committed Playwright e2e scripts in `client/e2e/`.

## Global Constraints

- No paid APIs anywhere; all AI runs client-side (project rule).
- `shared/protocol.ts` must stay dependency-free and erasable-syntax-only (types, interfaces, plain consts) — both tsconfigs compile it.
- Strokes stay vectors end-to-end; coordinates on the wire are normalized 0..1.
- **Show the user each modifier before starting the next** (spec rule). Tasks marked ⛔ CHECKPOINT must pause for the user's verdict.
- Design tokens (in `client/src/index.css`): paper `#F5F2EA`, ink `#141414`, acid `#E8FF3C`, humans `#FF4D1C`, AI `#2547F4`; fonts Archivo (display), Caveat (`.hand-note`), Space Mono (numbers). Match existing comment style: explanatory block comments about *why*, no play-by-play.
- Typecheck: `cd client && npx tsc -b` and `cd server && npm run typecheck`. Lint: `cd client && npm run lint`.
- Game constants from the spec (define once in `shared/protocol.ts`, Task 1/7): `CHAOS_SOME_CHANCE = 0.4`, `MEMORY_HIDE_AFTER_MS = 10_000`, `SIMUL_DRAW_MS = 45_000`, `SIMUL_VOTE_MS = 20_000`, `SIMUL_SUBMIT_GRACE_MS = 2_000`, `SIMUL_VOTE_POINTS = 60`, `SIMUL_AI_PICK_BONUS = 40`, `SIMUL_AI_RECOGNIZE_POINTS = 25`.
- Test hooks (needed by e2e, harmless in prod): server env `CHAOS_FORCE=<modifier>` forces every round's modifier; server env `SIMUL_DRAW_MS` overrides the simul draw window; client URL param `?chaos=<modifier>` forces `/play` rounds.
- Round 1 of a match never has a modifier (unless forced); never the same modifier twice in a row; `simul` requires ≥2 humans.

---

### Task 1: Chaos protocol types + server roll logic

**Files:**
- Modify: `shared/protocol.ts`
- Create: `server/src/chaos.ts`
- Create: `server/src/chaos.test.ts`
- Modify: `server/src/room.ts`, `server/src/index.ts`, `server/package.json`

**Interfaces:**
- Consumes: existing `RoundMeta`, `RoomState`, `Room` internals.
- Produces: `ChaosModifier`, `ChaosLevel`, `CHAOS_SOME_CHANCE`, `MEMORY_HIDE_AFTER_MS` (protocol); `RoundMeta.modifier: ChaosModifier | null`; `RoomState.chaosLevel: ChaosLevel`; `'set-chaos'` client→server event; server exports `rollModifier(opts)`, `isChaosModifier(v)`, `ENABLED_MODIFIERS` (starts `['mirror']`; later tasks push `'memory'`, `'jitter'`, `'simul'`).

- [ ] **Step 1: Install vitest in server; add test script**

```powershell
cd server; npm install -D vitest
```

In `server/package.json` scripts add: `"test": "vitest run"`.

- [ ] **Step 2: Protocol additions** — in `shared/protocol.ts`, after the `TIER_POINTS` const add:

```ts
// --- chaos modifiers (Phase 4) ----------------------------------------------

export type ChaosModifier = 'mirror' | 'memory' | 'jitter' | 'simul'
export type ChaosLevel = 'off' | 'some' | 'all'

/** chance that a round rolls a modifier at the 'some' level */
export const CHAOS_SOME_CHANCE = 0.4
/** memory draw: drawer's canvas goes dark this long after their first ink */
export const MEMORY_HIDE_AFTER_MS = 10_000
```

Add `modifier: ChaosModifier | null` to `RoundMeta`, `chaosLevel: ChaosLevel` to `RoomState`, and to `ClientToServerEvents`:

```ts
  /** host only, from the lobby */
  'set-chaos': (level: ChaosLevel) => void
```

- [ ] **Step 3: Write the failing tests** — `server/src/chaos.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { rollModifier } from './chaos.js'

const base = { level: 'all' as const, roundIndex: 3, humanCount: 3, last: null }
const pool: ('mirror' | 'memory' | 'jitter' | 'simul')[] = ['mirror', 'memory', 'jitter', 'simul']

describe('rollModifier', () => {
  test('off level never rolls', () => {
    expect(rollModifier({ ...base, level: 'off', pool, rng: () => 0 })).toBeNull()
  })
  test('round 1 is always clean', () => {
    expect(rollModifier({ ...base, roundIndex: 0, pool, rng: () => 0 })).toBeNull()
  })
  test('all level always rolls one from the pool', () => {
    expect(pool).toContain(rollModifier({ ...base, pool, rng: () => 0.99 }))
  })
  test('some level rolls only under the chance threshold', () => {
    expect(rollModifier({ ...base, level: 'some', pool, rng: () => 0.9 })).toBeNull()
    expect(rollModifier({ ...base, level: 'some', pool, rng: () => 0.1 })).not.toBeNull()
  })
  test('never repeats the previous modifier', () => {
    for (let i = 0; i < 40; i++) {
      expect(rollModifier({ ...base, last: 'mirror', pool })).not.toBe('mirror')
    }
  })
  test('simul needs at least 2 humans', () => {
    for (let i = 0; i < 40; i++) {
      expect(rollModifier({ ...base, humanCount: 1, pool })).not.toBe('simul')
    }
  })
})
```

- [ ] **Step 4: Run to verify failure** — `cd server && npm test` → FAIL (cannot find `./chaos.js`).

- [ ] **Step 5: Implement** — `server/src/chaos.ts`:

```ts
import { CHAOS_SOME_CHANCE, type ChaosLevel, type ChaosModifier } from '../../shared/protocol.js'

/**
 * Chaos modifier selection. Pure so it's testable; the Room feeds it state
 * and applies the result. ENABLED_MODIFIERS grows one entry per Phase 4 task
 * so half-built modifiers never get rolled in a real round.
 */

const ALL_MODIFIERS: ChaosModifier[] = ['mirror', 'memory', 'jitter', 'simul']

export const ENABLED_MODIFIERS: ChaosModifier[] = ['mirror']

/** validates the CHAOS_FORCE env test hook */
export function isChaosModifier(v: unknown): v is ChaosModifier {
  return typeof v === 'string' && (ALL_MODIFIERS as string[]).includes(v)
}

export function rollModifier(opts: {
  level: ChaosLevel
  roundIndex: number
  humanCount: number
  last: ChaosModifier | null
  pool?: ChaosModifier[]
  rng?: () => number
}): ChaosModifier | null {
  const rng = opts.rng ?? Math.random
  // matches open readable: the first round is always a classic one
  if (opts.level === 'off' || opts.roundIndex === 0) return null
  if (opts.level === 'some' && rng() >= CHAOS_SOME_CHANCE) return null
  let pool = (opts.pool ?? ENABLED_MODIFIERS).filter((m) => m !== 'simul' || opts.humanCount >= 2)
  if (pool.length > 1) pool = pool.filter((m) => m !== opts.last)
  if (pool.length === 0) return null
  return pool[Math.floor(rng() * pool.length)]
}
```

- [ ] **Step 6: Run tests** — `cd server && npm test` → all PASS.

- [ ] **Step 7: Wire into Room** — in `server/src/room.ts`:

Imports: add `type ChaosLevel, type ChaosModifier` to the protocol import; add `import { ENABLED_MODIFIERS, isChaosModifier, rollModifier } from './chaos.js'` (ENABLED_MODIFIERS import is used from Task 4 on; include now).

Fields (near `private aiScore`):

```ts
  private chaosLevel: ChaosLevel = 'off'
  private lastModifier: ChaosModifier | null = null
```

`ActiveRound` gains `modifier: ChaosModifier | null`.

New method after `startMatch`:

```ts
  setChaos(socketId: string, level: ChaosLevel): void {
    if (socketId !== this.hostId || this.phase.name !== 'lobby') return
    if (level !== 'off' && level !== 'some' && level !== 'all') return
    this.chaosLevel = level
    this.broadcast()
  }
```

In `startRound`, before building `this.round`:

```ts
    const forced = process.env.CHAOS_FORCE
    const modifier = isChaosModifier(forced)
      ? forced
      : rollModifier({
          level: this.chaosLevel,
          roundIndex: index,
          humanCount: this.humans.length,
          last: this.lastModifier,
        })
    if (modifier) this.lastModifier = modifier
```

Add `modifier,` to the `this.round = { ... }` literal, and after the existing `round N` system line: `if (modifier) this.system(\`CHAOS: ${modifier}\`)`. Add `modifier: round.modifier,` to `roundMeta()` and `chaosLevel: this.chaosLevel,` to `state()`.

- [ ] **Step 8: Register the socket event** — `server/src/index.ts`, next to `start-match`:

```ts
  socket.on('set-chaos', (level) => room?.setChaos(socket.id, level))
```

- [ ] **Step 9: Typecheck both packages.** `cd server && npm run typecheck` and `cd client && npx tsc -b` — client will fail until `Room.tsx`'s `RoomState` consumers compile; `RoundMeta.modifier`/`chaosLevel` are additive so both should PASS with no client changes.

- [ ] **Step 10: Commit** — `git add -A && git commit -m "Phase 4 task 1: chaos protocol + server modifier roll"`

---

### Task 2: Lobby chaos control + chaos banner/badge

**Files:**
- Create: `client/src/components/Chaos.tsx`, `client/src/components/Chaos.css`
- Modify: `client/src/pages/Room.tsx`, `client/src/pages/Room.css`
- Create: `client/e2e/harness.mjs`, `client/e2e/chaos-level.e2e.mjs`

**Interfaces:**
- Consumes: `RoomState.chaosLevel`, `RoundMeta.modifier`, `'set-chaos'` (Task 1).
- Produces: `ChaosBanner({ modifier, roundKey })`, `ChaosBadge({ modifier })`, `CHAOS_COPY` from `components/Chaos.tsx`; e2e harness exports `startStack(env)`, `launchPair()`, `createAndJoin(a, b)`, `startMatch(page)`, `drawLine(page, from, to)`, `inkBounds(page)`, `assert(cond, msg)`; dev stack on port **5199**.

- [ ] **Step 1: Components** — `client/src/components/Chaos.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { ChaosModifier } from '../../../shared/protocol'
import './Chaos.css'

export const CHAOS_COPY: Record<ChaosModifier, { title: string; note: string }> = {
  mirror: { title: 'MIRROR MODE', note: 'the ink lands flipped — steer backwards' },
  memory: { title: 'MEMORY DRAW', note: 'the canvas goes dark 10 seconds in' },
  jitter: { title: 'SHAKY HANDS', note: 'the pen has a mind of its own' },
  simul: { title: 'EVERYBODY DRAWS', note: 'same word, every canvas — the room votes' },
}

/** Full-canvas chaos announcement that shows itself out after a beat. */
export function ChaosBanner({ modifier, roundKey }: { modifier: ChaosModifier; roundKey: number }) {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    setVisible(true)
    const t = setTimeout(() => setVisible(false), 2600)
    return () => clearTimeout(t)
  }, [roundKey, modifier])
  if (!visible) return null
  const copy = CHAOS_COPY[modifier]
  return (
    <div className="chaos-banner" role="status">
      <span className="hand-note chaos-banner-kicker">chaos modifier</span>
      <strong className="chaos-banner-title">{copy.title}</strong>
      <span className="chaos-banner-note">{copy.note}</span>
    </div>
  )
}

export function ChaosBadge({ modifier }: { modifier: ChaosModifier }) {
  return (
    <span className="chaos-badge" title={CHAOS_COPY[modifier].note}>
      ⚡ {CHAOS_COPY[modifier].title}
    </span>
  )
}
```

`client/src/components/Chaos.css`:

```css
.chaos-banner {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  background: var(--acid, #e8ff3c);
  border: 3px solid var(--ink, #141414);
  animation: chaos-pop 0.25s ease-out;
  pointer-events: none;
}
.chaos-banner-title {
  font-family: 'Archivo', sans-serif;
  font-stretch: expanded;
  font-size: clamp(1.6rem, 4vw, 2.6rem);
  letter-spacing: 0.02em;
}
.chaos-banner-note { font-size: 0.95rem; }
.chaos-badge {
  font-family: 'Archivo', sans-serif;
  font-size: 0.72rem;
  font-stretch: expanded;
  padding: 0.15rem 0.5rem;
  background: var(--acid, #e8ff3c);
  border: 2px solid var(--ink, #141414);
  white-space: nowrap;
}
.chaos-level { display: flex; align-items: center; gap: 0.4rem; margin-block: 0.75rem; }
.chaos-level-label { font-family: 'Caveat', cursive; font-size: 1.1rem; }
.chaos-level-btn {
  font-size: 0.8rem;
  padding: 0.25rem 0.7rem;
  border: 2px solid var(--ink, #141414);
  background: transparent;
}
.chaos-level-btn.is-active { background: var(--acid, #e8ff3c); }
@keyframes chaos-pop { from { transform: scale(0.92); opacity: 0; } }
```

(If `index.css` doesn't define `--acid`/`--ink` custom properties, the hex fallbacks match the tokens.)

- [ ] **Step 2: Lobby control + wiring** — in `client/src/pages/Room.tsx`:

Imports: add `type ChaosLevel, type ChaosModifier` to the protocol import; `import { ChaosBadge, ChaosBanner } from '../components/Chaos'`.

`Lobby` gets a new prop `onSetChaos: (l: ChaosLevel) => void`; call site: `<Lobby room={room} meId={playerId} onStart={...} onSetChaos={(l) => socket.emit('set-chaos', l)} />`. Inside `Lobby`, before the Start button:

```tsx
      <div className="chaos-level" aria-label="chaos level">
        <span className="chaos-level-label">chaos:</span>
        {(['off', 'some', 'all'] as const).map((level) =>
          isHost ? (
            <button
              key={level}
              className={`chaos-level-btn${room.chaosLevel === level ? ' is-active' : ''}`}
              onClick={() => onSetChaos(level)}
            >
              {level}
            </button>
          ) : (
            room.chaosLevel === level && (
              <span key={level} className="chaos-level-readout">{level}</span>
            )
          ),
        )}
      </div>
```

Badge in the prompt bar (inside `.room-round-info`, before the round count):

```tsx
              {meta.modifier && <ChaosBadge modifier={meta.modifier} />}
```

Banner inside `.room-canvas` (sibling of the canvas, after it):

```tsx
              {drawing?.round.modifier && (
                <ChaosBanner modifier={drawing.round.modifier} roundKey={drawing.round.roundIndex} />
              )}
```

`.room-canvas` must be `position: relative` in `Room.css` for the banner overlay — add if missing.

- [ ] **Step 3: E2E harness** — `client/e2e/harness.mjs` (committed; reused by every later e2e script):

```js
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

/** Shared harness: spawns server+vite (port 5199), Playwright helpers. */

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const serverDir = path.resolve(clientDir, '..', 'server')
export const BASE = 'http://localhost:5199'

async function waitFor(url, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`timed out waiting for ${url}`)
}

export async function startStack(env = {}) {
  const server = spawn(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'src/index.ts'],
    { cwd: serverDir, env: { ...process.env, ...env }, stdio: 'inherit' },
  )
  const vite = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--port', '5199', '--strictPort'],
    { cwd: clientDir, stdio: 'inherit' },
  )
  await waitFor('http://localhost:3001/health')
  await waitFor(BASE)
  return {
    stop() {
      server.kill()
      vite.kill()
    },
  }
}

export async function launchPair() {
  const browser = await chromium.launch()
  return { browser, a: await browser.newPage(), b: await browser.newPage() }
}

export async function createAndJoin(a, b) {
  await a.goto(`${BASE}/rooms`)
  await a.fill('input[placeholder="doodle master"]', 'Alice')
  await a.click('text=Create a room')
  await a.waitForSelector('.room-lobby-code-value')
  const code = (await a.textContent('.room-lobby-code-value')).trim()
  await b.goto(`${BASE}/rooms/${code}`)
  await b.fill('input[placeholder="doodle master"]', 'Bob')
  await b.click('button:has-text("Join")')
  await b.waitForSelector('.room-lobby-players')
  return code
}

export async function startMatch(a) {
  await a.click('text=Start match')
  await a.waitForSelector('canvas')
}

/** Slow drag in canvas-fraction coords, so point timestamps spread out. */
export async function drawLine(page, from, to, steps = 30) {
  const box = await page.locator('canvas').first().boundingBox()
  const at = (f) => ({ x: box.x + box.width * f.x, y: box.y + box.height * f.y })
  const p0 = at(from)
  const p1 = at(to)
  await page.mouse.move(p0.x, p0.y)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      p0.x + ((p1.x - p0.x) * i) / steps,
      p0.y + ((p1.y - p0.y) * i) / steps,
    )
    await page.waitForTimeout(12)
  }
  await page.mouse.up()
}

/** Inked-pixel bounding box + count on the page's first canvas, CSS px. */
export async function inkBounds(page) {
  return page.locator('canvas').first().evaluate((canvas) => {
    const { width, height } = canvas
    const data = canvas.getContext('2d').getImageData(0, 0, width, height).data
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, count = 0
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        if (data[i + 3] > 100 && data[i] < 120) {
          count++
          if (x < minX) minX = x
          if (y < minY) minY = y
          if (x > maxX) maxX = x
          if (y > maxY) maxY = y
        }
      }
    }
    const dpr = window.devicePixelRatio || 1
    return {
      minX: minX / dpr, minY: minY / dpr, maxX: maxX / dpr, maxY: maxY / dpr,
      count, width: width / dpr, height: height / dpr,
    }
  })
}

export function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`ok — ${msg}`)
}
```

- [ ] **Step 4: chaos-level e2e** — `client/e2e/chaos-level.e2e.mjs`:

```js
import { assert, createAndJoin, launchPair, startStack } from './harness.mjs'

const stack = await startStack({ CHAOS_FORCE: 'mirror' })
const { browser, a, b } = await launchPair()
try {
  await createAndJoin(a, b)
  // host sees buttons; guest sees a readout
  assert((await a.locator('.chaos-level-btn').count()) === 3, 'host sees 3 chaos buttons')
  assert((await b.locator('.chaos-level-btn').count()) === 0, 'guest sees no buttons')
  await a.click('.chaos-level-btn:has-text("all")')
  await b.waitForSelector('.chaos-level-readout:has-text("all")')
  assert(true, 'guest lobby shows the new level')
  // forced modifier flows into the round meta → banner + badge on both clients
  await a.click('text=Start match')
  await a.waitForSelector('.chaos-banner')
  await b.waitForSelector('.chaos-banner')
  await a.waitForSelector('.chaos-badge')
  await b.waitForSelector('.chaos-badge')
  assert(true, 'banner and badge visible to drawer and guesser')
  console.log('chaos-level e2e: PASS')
} finally {
  await browser.close()
  stack.stop()
}
```

- [ ] **Step 5: Run it** — from repo root: `node client/e2e/chaos-level.e2e.mjs` → all `ok` lines + PASS. Typecheck + lint client.

- [ ] **Step 6: Commit** — `git commit -m "Phase 4 task 2: lobby chaos control, banner/badge, e2e harness"`

---

### Task 3: Mirror modifier ⛔ CHECKPOINT after this task

**Files:**
- Create: `client/src/lib/chaos.ts`, `client/src/lib/chaos.test.ts`
- Modify: `client/src/components/DrawingCanvas.tsx`, `client/src/pages/Room.tsx`, `client/package.json`
- Create: `client/e2e/mirror.e2e.mjs`

**Interfaces:**
- Consumes: `RoundMeta.modifier`, harness exports (Task 2), `StrokePoint` from `lib/strokes`.
- Produces: `lib/chaos.ts` exports `mirrorPoint(p, canvasSize)`, `transformFor(modifier)` → `PointTransform | undefined`, `type PointTransform = (p: StrokePoint, canvasSize: number) => StrokePoint`; `DrawingCanvas` prop `transformPoint?: PointTransform`.

- [ ] **Step 1: Install vitest in client** — `cd client; npm install -D vitest`; add `"test": "vitest run"` to scripts.

- [ ] **Step 2: Failing test** — `client/src/lib/chaos.test.ts`:

```ts
import { expect, test } from 'vitest'
import { mirrorPoint, transformFor } from './chaos'

test('mirrorPoint flips x across the canvas width', () => {
  expect(mirrorPoint({ x: 100, y: 50, t: 7 }, 460)).toEqual({ x: 360, y: 50, t: 7 })
})

test('transformFor maps modifiers to transforms', () => {
  expect(transformFor('mirror')).toBe(mirrorPoint)
  expect(transformFor(null)).toBeUndefined()
  expect(transformFor('memory')).toBeUndefined() // memory is a display effect, not a transform
})
```

Run `cd client && npm test` → FAIL (module not found).

- [ ] **Step 3: Implement** — `client/src/lib/chaos.ts`:

```ts
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
```

Run `npm test` → PASS.

- [ ] **Step 4: DrawingCanvas prop** — in `client/src/components/DrawingCanvas.tsx`: add `transformPoint?: (p: StrokePoint, canvasSize: number) => StrokePoint` to `DrawingCanvasProps` **and** to the function's parameter destructuring (`StrokePoint` is already imported as a type). Add a ref alongside `disabledRef`:

```tsx
  const transformRef = useRef(transformPoint)
  transformRef.current = transformPoint
```

Replace `toPoint`'s return with:

```tsx
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
```

- [ ] **Step 5: Wire in Room.tsx** — on the drawer's `<DrawingCanvas>` add:

```tsx
                    transformPoint={transformFor(drawing?.round.modifier)}
```

with `import { transformFor } from '../lib/chaos'`.

- [ ] **Step 6: e2e** — `client/e2e/mirror.e2e.mjs`:

```js
import { assert, createAndJoin, drawLine, inkBounds, launchPair, startMatch, startStack } from './harness.mjs'

const stack = await startStack({ CHAOS_FORCE: 'mirror' })
const { browser, a, b } = await launchPair()
try {
  await createAndJoin(a, b)
  await startMatch(a)
  await a.waitForTimeout(3000) // let the chaos banner clear
  // Alice (round-1 drawer) draws a vertical line at the LEFT edge (x = 12%)
  await drawLine(a, { x: 0.12, y: 0.25 }, { x: 0.12, y: 0.75 })
  await a.waitForTimeout(600)
  const drawer = await inkBounds(a)
  const guesser = await inkBounds(b)
  assert(drawer.count > 50, 'drawer canvas has ink')
  assert(drawer.minX > drawer.width * 0.75, `drawer ink mirrored right (minX=${drawer.minX})`)
  assert(guesser.count > 50, 'guesser canvas has ink')
  assert(guesser.minX > guesser.width * 0.75, `guesser sees the mirrored stroke (minX=${guesser.minX})`)
  console.log('mirror e2e: PASS')
} finally {
  await browser.close()
  stack.stop()
}
```

Run: `node client/e2e/mirror.e2e.mjs` → PASS. Also run `node client/e2e/chaos-level.e2e.mjs` (regression), typecheck, lint.

- [ ] **Step 7: Commit** — `git commit -m "Phase 4 task 3: mirror modifier (capture-time flip)"`

- [ ] **Step 8: ⛔ CHECKPOINT — show the user.** Tell them: start both dev servers, host a room, set chaos to `all`, play a round or two until MIRROR MODE lands (or run with `CHAOS_FORCE=mirror`). Wait for their verdict before Task 4.

---

### Task 4: Memory draw ⛔ CHECKPOINT after this task

**Files:**
- Modify: `client/src/components/DrawingCanvas.tsx`, `client/src/pages/Room.tsx`, `client/src/pages/Room.css`, `server/src/chaos.ts`
- Create: `client/e2e/memory.e2e.mjs`

**Interfaces:**
- Consumes: `MEMORY_HIDE_AFTER_MS` (protocol), harness.
- Produces: `DrawingCanvas` prop `hideInk?: boolean` (records input, paints nothing, clears on hide); Room-side first-ink timer pattern (reused by Task 6 in `/play`).

- [ ] **Step 1: DrawingCanvas `hideInk`** — add prop `hideInk?: boolean` with `hideInkRef` (same pattern as `disabledRef`). Factor the redraw loop out of the undo effect into a component-scope helper:

```tsx
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
```

The undo effect body becomes: pop the stroke, `repaintAll()`, fire `onStrokesChange` (unchanged semantics). Add a hide effect:

```tsx
  useEffect(() => {
    hideInkRef.current = hideInk
    repaintAll() // hiding clears; unhiding (next round) restores
  }, [hideInk])
```

In `onPointerDown` and `onPointerMove`, wrap the `ctx.*` painting calls in `if (!hideInkRef.current) { ... }` — points are still recorded either way.

- [ ] **Step 2: Room.tsx memory timer** — the canvas goes dark `MEMORY_HIDE_AFTER_MS` after the drawer's **first ink**:

```tsx
  const [memoryHidden, setMemoryHidden] = useState(false)
  const memoryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const modifierRef = useRef<ChaosModifier | null>(null)
  modifierRef.current = drawing?.round.modifier ?? null

  const armMemoryTimer = useCallback((strokes: Stroke[]) => {
    if (modifierRef.current !== 'memory' || memoryTimerRef.current || strokes.length === 0) return
    memoryTimerRef.current = setTimeout(() => setMemoryHidden(true), MEMORY_HIDE_AFTER_MS)
  }, [])
```

Call `armMemoryTimer(strokes)` first thing inside both `onStrokesChange` and `onDrawingStrokes`. In the new-round housekeeping block inside `onRoomState` add:

```tsx
        if (memoryTimerRef.current) {
          clearTimeout(memoryTimerRef.current)
          memoryTimerRef.current = null
        }
        setMemoryHidden(false)
```

Pass `hideInk={memoryHidden}` on the drawer's `<DrawingCanvas>`, and under it render the veil (non-blocking):

```tsx
                  {memoryHidden && drawing && (
                    <p className="hand-note room-memory-veil">
                      lights out — finish it from memory
                    </p>
                  )}
```

`Room.css`: `.room-memory-veil { position: absolute; inset: auto 0 12px 0; text-align: center; pointer-events: none; }`

Imports: `MEMORY_HIDE_AFTER_MS`, `type ChaosModifier` from protocol.

- [ ] **Step 3: Enable the roll** — `server/src/chaos.ts`: `ENABLED_MODIFIERS: ChaosModifier[] = ['mirror', 'memory']`.

- [ ] **Step 4: e2e** — `client/e2e/memory.e2e.mjs`:

```js
import { assert, createAndJoin, drawLine, inkBounds, launchPair, startMatch, startStack } from './harness.mjs'

const stack = await startStack({ CHAOS_FORCE: 'memory' })
const { browser, a, b } = await launchPair()
try {
  await createAndJoin(a, b)
  await startMatch(a)
  await a.waitForTimeout(3000)
  await drawLine(a, { x: 0.3, y: 0.3 }, { x: 0.7, y: 0.3 })
  assert((await inkBounds(a)).count > 50, 'drawer sees ink before the cutoff')
  await a.waitForTimeout(10_800) // MEMORY_HIDE_AFTER_MS + margin
  assert((await inkBounds(a)).count === 0, 'drawer canvas dark after 10s')
  const guesserBefore = (await inkBounds(b)).count
  assert(guesserBefore > 50, 'guesser still sees the drawing')
  await a.waitForSelector('.room-memory-veil')
  // blind strokes keep relaying
  await drawLine(a, { x: 0.3, y: 0.6 }, { x: 0.7, y: 0.6 })
  await a.waitForTimeout(600)
  assert((await inkBounds(a)).count === 0, 'drawer stays blind while drawing')
  assert((await inkBounds(b)).count > guesserBefore, 'guesser receives the blind strokes')
  console.log('memory e2e: PASS')
} finally {
  await browser.close()
  stack.stop()
}
```

Run it + mirror + chaos-level regressions; typecheck; lint; `cd server && npm test`.

- [ ] **Step 5: Commit** — `git commit -m "Phase 4 task 4: memory draw (drawer goes blind at 10s)"`

- [ ] **Step 6: ⛔ CHECKPOINT — show the user** (same demo instructions, `CHAOS_FORCE=memory`).

---

### Task 5: Jitter ⛔ CHECKPOINT after this task

**Files:**
- Modify: `client/src/lib/chaos.ts`, `client/src/lib/chaos.test.ts`, `server/src/chaos.ts`
- Create: `client/e2e/jitter.e2e.mjs`

**Interfaces:**
- Consumes: `PointTransform` (Task 3).
- Produces: `jitterPoint(p, canvasSize)`; `transformFor('jitter')` returns it.

- [ ] **Step 1: Failing tests** — append to `client/src/lib/chaos.test.ts`:

```ts
import { jitterPoint } from './chaos'

test('jitter displacement is bounded', () => {
  for (let t = 0; t < 4000; t += 37) {
    const p = jitterPoint({ x: 200, y: 200, t }, 460)
    expect(Math.abs(p.x - 200)).toBeLessThan(460 * 0.012 * 1.5 + 1e-9)
    expect(Math.abs(p.y - 200)).toBeLessThan(460 * 0.012 * 1.5 + 1e-9)
  }
})

test('jitter drifts smoothly between adjacent samples', () => {
  for (let t = 0; t < 2000; t += 12) {
    const p1 = jitterPoint({ x: 200, y: 200, t }, 460)
    const p2 = jitterPoint({ x: 200, y: 200, t: t + 12 }, 460)
    expect(Math.hypot(p2.x - p1.x, p2.y - p1.y)).toBeLessThan(2.5)
  }
})

test('jitter actually moves the pen', () => {
  const spread = new Set<number>()
  for (let t = 0; t < 2000; t += 50) spread.add(Math.round(jitterPoint({ x: 200, y: 200, t }, 460).y))
  expect(spread.size).toBeGreaterThan(4)
})
```

Run → FAIL (`jitterPoint` not exported).

- [ ] **Step 2: Implement** — in `client/src/lib/chaos.ts`:

```ts
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
```

In `transformFor` add `if (modifier === 'jitter') return jitterPoint`. Update the Task 3 `transformFor` test if it asserts jitter is undefined (it doesn't — only memory/null). Run `npm test` → PASS.

- [ ] **Step 3: Enable** — server `ENABLED_MODIFIERS` → `['mirror', 'memory', 'jitter']`.

- [ ] **Step 4: e2e** — `client/e2e/jitter.e2e.mjs`:

```js
import { assert, createAndJoin, drawLine, inkBounds, launchPair, startMatch, startStack } from './harness.mjs'

const stack = await startStack({ CHAOS_FORCE: 'jitter' })
const { browser, a, b } = await launchPair()
try {
  await createAndJoin(a, b)
  await startMatch(a)
  await a.waitForTimeout(3000)
  // a horizontal line: without jitter its ink band is ~4px tall (line width)
  await drawLine(a, { x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }, 45)
  await a.waitForTimeout(600)
  const drawer = await inkBounds(a)
  const guesser = await inkBounds(b)
  assert(drawer.maxY - drawer.minY > 9, `drawer stroke wobbles (band=${(drawer.maxY - drawer.minY).toFixed(1)}px)`)
  assert(guesser.maxY - guesser.minY > 9, `guesser sees the same wobble (band=${(guesser.maxY - guesser.minY).toFixed(1)}px)`)
  console.log('jitter e2e: PASS')
} finally {
  await browser.close()
  stack.stop()
}
```

Run it + prior e2e scripts; `npm test` both packages; typecheck; lint.

- [ ] **Step 5: Commit** — `git commit -m "Phase 4 task 5: jitter (shaky-hands input wobble)"`

- [ ] **Step 6: ⛔ CHECKPOINT — show the user** (`CHAOS_FORCE=jitter`).

---

### Task 6: /play chaos toggle ⛔ CHECKPOINT after this task

**Files:**
- Modify: `client/src/lib/chaos.ts`, `client/src/lib/chaos.test.ts`, `client/src/pages/Play.tsx`, `client/src/pages/Play.css`
- Create: `client/e2e/play-chaos.e2e.mjs`

**Interfaces:**
- Consumes: `transformFor`, `jitterPoint`/`mirrorPoint`, `ChaosBanner`/`ChaosBadge`, `MEMORY_HIDE_AFTER_MS`, `DrawingCanvas` props (Tasks 3–5).
- Produces: `CANVAS_MODIFIERS`, `type CanvasChaosModifier`, `isCanvasModifier(v)`, `rollCanvasModifier(roundIndex, last, rng?)` in `lib/chaos.ts`.

- [ ] **Step 1: Failing tests** — append to `chaos.test.ts`:

```ts
import { rollCanvasModifier } from './chaos'

test('single-player roll: round 1 clean, ~40% odds, no repeats', () => {
  expect(rollCanvasModifier(0, null, () => 0)).toBeNull()
  expect(rollCanvasModifier(2, null, () => 0.9)).toBeNull() // over the 40% chance
  const rolled = rollCanvasModifier(2, 'mirror', () => 0.1)
  expect(rolled).not.toBeNull()
  expect(rolled).not.toBe('mirror')
})
```

Run → FAIL.

- [ ] **Step 2: Implement** — in `lib/chaos.ts`:

```ts
import { CHAOS_SOME_CHANCE } from '../../../shared/protocol'

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
```

Run `npm test` → PASS.

- [ ] **Step 3: Play.tsx wiring.** Imports:

```tsx
import { MEMORY_HIDE_AFTER_MS } from '../../../shared/protocol'
import { ChaosBadge, ChaosBanner } from '../components/Chaos'
import { isCanvasModifier, rollCanvasModifier, transformFor, type CanvasChaosModifier } from '../lib/chaos'
```

State/refs next to the existing ones:

```tsx
  const [chaosEnabled, setChaosEnabled] = useState(
    () => localStorage.getItem('drawing-arena-chaos') === '1',
  )
  const [modifier, setModifier] = useState<CanvasChaosModifier | null>(null)
  const [memoryHidden, setMemoryHidden] = useState(false)
  const chaosEnabledRef = useRef(chaosEnabled)
  chaosEnabledRef.current = chaosEnabled
  const modifierRef = useRef<CanvasChaosModifier | null>(null)
  const lastModRef = useRef<CanvasChaosModifier | null>(null)
  const memoryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
```

At the top of `startRound` (inside the callback, after the `guesser` guard):

```tsx
      const forced = new URLSearchParams(window.location.search).get('chaos')
      const next = isCanvasModifier(forced)
        ? forced
        : chaosEnabledRef.current
          ? rollCanvasModifier(roundIndex, lastModRef.current)
          : null
      if (next) lastModRef.current = next
      modifierRef.current = next
      setModifier(next)
      setMemoryHidden(false)
      if (memoryTimerRef.current) {
        clearTimeout(memoryTimerRef.current)
        memoryTimerRef.current = null
      }
```

Replace `onStrokes` with a version that also arms the memory timer:

```tsx
  const onStrokes = useCallback((strokes: Stroke[]) => {
    if (
      modifierRef.current === 'memory' &&
      !memoryTimerRef.current &&
      strokes.length > 0
    ) {
      memoryTimerRef.current = setTimeout(() => setMemoryHidden(true), MEMORY_HIDE_AFTER_MS)
    }
    aiRef.current?.observe(strokes)
  }, [])
```

Canvas props: `transformPoint={transformFor(modifier)} hideInk={memoryHidden}`. In `.play-canvas`, after the tools block:

```tsx
              {modifier && state.phase.name === 'drawing' && (
                <ChaosBanner
                  modifier={modifier}
                  roundKey={state.phase.roundIndex}
                />
              )}
              {memoryHidden && state.phase.name === 'drawing' && (
                <p className="hand-note play-memory-veil">lights out — finish it from memory</p>
              )}
```

Badge in `.play-round-info` before the round count: `{modifier && <ChaosBadge modifier={modifier} />}`. `Play.css`: copy of the veil rule (`.play-memory-veil { position: absolute; inset: auto 0 12px 0; text-align: center; pointer-events: none; }`); `.play-canvas` is already the positioning context (verify `position: relative`, add if missing).

Intro toggle, after `.play-intro-rules`:

```tsx
          <label className="play-chaos-toggle">
            <input
              type="checkbox"
              checked={chaosEnabled}
              onChange={(e) => {
                setChaosEnabled(e.target.checked)
                localStorage.setItem('drawing-arena-chaos', e.target.checked ? '1' : '0')
              }}
            />
            chaos rounds <span className="hand-note">(mirror · memory · shaky hands)</span>
          </label>
```

`.play-chaos-toggle { display: flex; gap: 0.5rem; align-items: center; margin-block: 0.75rem; }`

- [ ] **Step 4: e2e** — `client/e2e/play-chaos.e2e.mjs` (single page, forced mirror):

```js
import { chromium } from 'playwright'
import { assert, BASE, drawLine, inkBounds, startStack } from './harness.mjs'

const stack = await startStack()
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.goto(`${BASE}/play?chaos=mirror`)
  await page.click('text=Start match', { timeout: 30_000 }) // waits out model load
  await page.waitForSelector('canvas')
  await page.waitForTimeout(3000)
  await drawLine(page, { x: 0.12, y: 0.25 }, { x: 0.12, y: 0.75 })
  const ink = await inkBounds(page)
  assert(ink.count > 50, 'canvas has ink')
  assert(ink.minX > ink.width * 0.75, `ink mirrored right (minX=${ink.minX})`)
  assert(await page.locator('.chaos-badge').isVisible(), 'chaos badge on /play')
  console.log('play-chaos e2e: PASS')
} finally {
  await browser.close()
  stack.stop()
}
```

Run; typecheck; lint; unit tests.

- [ ] **Step 5: Commit** — `git commit -m "Phase 4 task 6: /play chaos toggle (canvas modifiers in single-player)"`

- [ ] **Step 6: ⛔ CHECKPOINT — show the user** (`/play`, enable "chaos rounds"; `?chaos=memory` etc. to force).

---

### Task 7: Simultaneous mode — server

**Files:**
- Modify: `shared/protocol.ts`, `server/src/chaos.ts`, `server/src/chaos.test.ts`, `server/src/room.ts`, `server/src/index.ts`

**Interfaces:**
- Consumes: Task 1 chaos plumbing; `normalizeGuess`, `pushFeed`, `endRound`, timer helpers in `room.ts`.
- Produces (protocol): `SimulEntry { playerId, name, strokes: NormPoint[][], aiTopGuess, aiConfidence }`; `RoomPhase` variant `{ name: 'simul-vote'; round: RoundMeta; gallery: SimulEntry[]; votesEndAtMs: number }`; `RoundReveal.reason` gains `'simul-done'`; `RoundReveal.simulVotes?: Record<string, number>` and `aiPickId?: string | null`; events `'simul-submit'(strokes, aiTopGuess, aiConfidence)` and `'simul-vote'(targetPlayerId)`; constants `SIMUL_*` (see Global Constraints). Server: `scoreSimul(entries, votes, word)`.

- [ ] **Step 1: Protocol.** Add the `SIMUL_*` constants next to `CHAOS_SOME_CHANCE`:

```ts
export const SIMUL_DRAW_MS = 45_000
export const SIMUL_VOTE_MS = 20_000
export const SIMUL_SUBMIT_GRACE_MS = 2_000
export const SIMUL_VOTE_POINTS = 60
export const SIMUL_AI_PICK_BONUS = 40
export const SIMUL_AI_RECOGNIZE_POINTS = 25
```

After `RoundMeta`:

```ts
/** one player's simultaneous-mode drawing, revealed at vote time */
export interface SimulEntry {
  playerId: string
  name: string
  strokes: NormPoint[][]
  /** that client's own AI verdict on its canvas (normalized guess text) */
  aiTopGuess: string
  aiConfidence: number
}
```

`RoomPhase` gains `| { name: 'simul-vote'; round: RoundMeta; gallery: SimulEntry[]; votesEndAtMs: number }`. `RoundReveal`: reason union += `'simul-done'`; add optional `simulVotes?: Record<string, number>` and `aiPickId?: string | null`. `ClientToServerEvents` +=:

```ts
  /** simultaneous mode: my drawing + my client's AI verdict, at the deadline */
  'simul-submit': (strokes: NormPoint[][], aiTopGuess: string, aiConfidence: number) => void
  /** simultaneous mode: vote for the best drawing (not your own) */
  'simul-vote': (targetPlayerId: string) => void
```

- [ ] **Step 2: Failing tests** — append to `server/src/chaos.test.ts`:

```ts
import { scoreSimul } from './chaos.js'
import type { SimulEntry } from '../../shared/protocol.js'

const entry = (playerId: string, aiTopGuess: string, aiConfidence: number): SimulEntry => ({
  playerId, name: playerId, strokes: [], aiTopGuess, aiConfidence,
})

describe('scoreSimul', () => {
  test('votes pay 60 each; AI pick bonus goes to the most-confident correct canvas', () => {
    const entries = [entry('p1', 'duck', 0.9), entry('p2', 'duck', 0.7), entry('p3', 'cat', 0.99)]
    const votes = new Map([['p2', 'p1'], ['p3', 'p1'], ['p1', 'p2']])
    const r = scoreSimul(entries, votes, 'duck')
    expect(r.gains.get('p1')).toBe(2 * 60 + 40) // two votes + AI pick
    expect(r.gains.get('p2')).toBe(60)
    expect(r.aiPickId).toBe('p1')
    expect(r.aiPoints).toBe(2 * 25) // it recognized two ducks
    expect(r.voteCounts.get('p1')).toBe(2)
  })
  test('AI-pick tie goes to the earlier submission', () => {
    const r = scoreSimul([entry('p1', 'duck', 0.8), entry('p2', 'duck', 0.8)], new Map(), 'duck')
    expect(r.aiPickId).toBe('p1')
  })
  test('no correct canvases: no pick, no AI points', () => {
    const r = scoreSimul([entry('p1', 'cat', 0.9)], new Map(), 'duck')
    expect(r.aiPickId).toBeNull()
    expect(r.aiPoints).toBe(0)
  })
})
```

Run → FAIL (`scoreSimul` missing).

- [ ] **Step 3: Implement scoring** — append to `server/src/chaos.ts`:

```ts
import {
  SIMUL_AI_PICK_BONUS,
  SIMUL_AI_RECOGNIZE_POINTS,
  SIMUL_VOTE_POINTS,
  type SimulEntry,
} from '../../shared/protocol.js'

export interface SimulScore {
  gains: Map<string, number>
  voteCounts: Map<string, number>
  aiPickId: string | null
  aiPoints: number
}

/** Pure simultaneous-mode scoring: human votes + the AI judge's verdicts. */
export function scoreSimul(
  entries: SimulEntry[],
  votes: Map<string, string>,
  word: string,
): SimulScore {
  const voteCounts = new Map<string, number>()
  for (const target of votes.values()) voteCounts.set(target, (voteCounts.get(target) ?? 0) + 1)
  const gains = new Map<string, number>()
  for (const [target, n] of voteCounts) gains.set(target, n * SIMUL_VOTE_POINTS)

  let aiPickId: string | null = null
  let bestConfidence = -1
  let recognized = 0
  for (const e of entries) {
    if (e.aiTopGuess !== word) continue
    recognized += 1
    // strict > keeps ties on the earlier submission
    if (e.aiConfidence > bestConfidence) {
      bestConfidence = e.aiConfidence
      aiPickId = e.playerId
    }
  }
  if (aiPickId) gains.set(aiPickId, (gains.get(aiPickId) ?? 0) + SIMUL_AI_PICK_BONUS)
  return { gains, voteCounts, aiPickId, aiPoints: recognized * SIMUL_AI_RECOGNIZE_POINTS }
}
```

Enable the roll: `ENABLED_MODIFIERS` → `['mirror', 'memory', 'jitter', 'simul']`. Run `npm test` → PASS.

- [ ] **Step 4: Room flow.** In `server/src/room.ts`:

Imports: add `SIMUL_DRAW_MS, SIMUL_SUBMIT_GRACE_MS, SIMUL_VOTE_MS, type NormPoint, type SimulEntry` to the protocol import and `scoreSimul` to the chaos import. Module-level, next to `MAX_GUESS_LENGTH`:

```ts
const MAX_SIMUL_STROKES = 200
const MAX_SIMUL_POINTS = 20_000

/** e2e hook: SIMUL_DRAW_MS env shortens the draw window */
function simulDrawMs(): number {
  return Number(process.env.SIMUL_DRAW_MS ?? 0) || SIMUL_DRAW_MS
}

/** Distrust the wire: clamp coords, drop junk, cap volume. */
function sanitizeStrokes(raw: unknown): NormPoint[][] {
  if (!Array.isArray(raw)) return []
  const out: NormPoint[][] = []
  let points = 0
  for (const stroke of raw.slice(0, MAX_SIMUL_STROKES)) {
    if (!Array.isArray(stroke)) continue
    const clean: NormPoint[] = []
    for (const p of stroke) {
      if (points >= MAX_SIMUL_POINTS) break
      const x = Number(p?.x)
      const y = Number(p?.y)
      const t = Number(p?.t)
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(t)) continue
      clean.push({ x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)), t: Math.max(0, t) })
      points += 1
    }
    if (clean.length > 0) out.push(clean)
  }
  return out
}
```

`ActiveRound` gains:

```ts
  simul: null | {
    submissions: SimulEntry[]
    votes: Map<string, string> // voterId -> targetId
    closed: boolean
    /** humans present at round start — late joiners spectate (spec rule) */
    eligible: Set<string>
    voteCounts?: Map<string, number>
    aiPickId?: string | null
  }
```

In `startRound`: `const isSimul = modifier === 'simul'`; `const durationMs = isSimul ? simulDrawMs() : ROUND_DURATION_MS`; use `endsAt: now + durationMs` and add to the round literal:

```ts
      simul: isSimul
        ? {
            submissions: [],
            votes: new Map(),
            closed: false,
            eligible: new Set(this.humans.map((h) => h.socketId)),
          }
        : null,
``` Replace the prompt send with:

```ts
    if (isSimul) {
      // everyone draws the same word — it's public inside the round
      for (const h of this.humans) this.io.to(h.socketId).emit('your-prompt', prompt.name)
    } else {
      this.io.to(drawer.socketId).emit('your-prompt', prompt.name)
    }
```

Replace the round timer block with:

```ts
    const token = this.round.token
    if (isSimul) {
      this.setTimer(() => {
        if (this.round?.token === token) this.closeSubmissions()
      }, durationMs + SIMUL_SUBMIT_GRACE_MS)
    } else {
      this.setTimer(() => {
        if (this.round?.token === token && this.phase.name === 'drawing') this.endRound('timeout')
      }, durationMs)
    }
```

Guard the normal-round paths (simul rounds have no shared canvas or guessing): first line of `strokeEvent`, `guess`, and `aiGuess` add `if (this.round?.simul) return`.

New methods (after `aiGuess`):

```ts
  /** Simultaneous mode: a player's drawing + their client's AI verdict. */
  simulSubmit(socketId: string, strokes: unknown, aiTopGuess: string, aiConfidence: number): void {
    const round = this.round
    const human = this.humans.find((h) => h.socketId === socketId)
    if (!round?.simul || this.phase.name !== 'drawing' || !human || round.simul.closed) return
    if (!round.simul.eligible.has(socketId)) return // late joiners spectate this round
    if (round.simul.submissions.some((e) => e.playerId === socketId)) return
    round.simul.submissions.push({
      playerId: socketId,
      name: human.name,
      strokes: sanitizeStrokes(strokes),
      aiTopGuess: normalizeGuess(String(aiTopGuess ?? '')).slice(0, MAX_GUESS_LENGTH),
      aiConfidence: Math.min(1, Math.max(0, Number(aiConfidence) || 0)),
    })
    const eligibleNow = this.humans.filter((h) => round.simul!.eligible.has(h.socketId)).length
    if (round.simul.submissions.length >= eligibleNow) this.closeSubmissions()
  }

  private closeSubmissions(): void {
    const round = this.round
    if (!round?.simul || round.simul.closed || this.phase.name !== 'drawing') return
    round.simul.closed = true
    this.clearTimer()
    if (round.simul.submissions.length < 2) {
      // no contest — not enough drawings to vote on
      this.endRound('simul-done')
      return
    }
    this.phase = {
      name: 'simul-vote',
      round: this.roundMeta(),
      gallery: round.simul.submissions,
      votesEndAtMs: Date.now() + SIMUL_VOTE_MS,
    }
    this.system('pens down — vote for the best drawing')
    this.broadcast()
    // the judge shares its read on every canvas (it never saw the word)
    for (const e of round.simul.submissions) {
      this.pushFeed(
        AI_PLAYER_ID, AI_PLAYER_NAME, true, 'guess',
        e.aiTopGuess ? `${e.name}'s looks like "${e.aiTopGuess}" to me` : `${e.name} drew… something?`,
      )
    }
    const token = round.token
    this.setTimer(() => {
      if (this.round?.token === token) this.finishVote()
    }, SIMUL_VOTE_MS)
  }

  simulVote(socketId: string, targetId: string): void {
    const round = this.round
    if (!round?.simul || this.phase.name !== 'simul-vote') return
    if (!this.humans.some((h) => h.socketId === socketId)) return
    if (socketId === targetId || round.simul.votes.has(socketId)) return
    if (!round.simul.submissions.some((e) => e.playerId === targetId)) return
    round.simul.votes.set(socketId, targetId)
    if (round.simul.votes.size >= this.humans.length) this.finishVote()
  }

  private finishVote(): void {
    const round = this.round
    if (!round?.simul || this.phase.name !== 'simul-vote') return
    this.clearTimer()
    const { gains, voteCounts, aiPickId, aiPoints } = scoreSimul(
      round.simul.submissions, round.simul.votes, round.word,
    )
    for (const [playerId, pts] of gains) {
      const human = this.humans.find((h) => h.socketId === playerId)
      if (human) {
        human.score += pts
        round.gains.set(playerId, pts)
      }
    }
    if (aiPoints > 0) {
      this.aiScore += aiPoints
      round.gains.set(AI_PLAYER_ID, aiPoints)
    }
    round.simul.voteCounts = voteCounts
    round.simul.aiPickId = aiPickId
    if (aiPickId) {
      const pick = round.simul.submissions.find((e) => e.playerId === aiPickId)
      this.pushFeed(AI_PLAYER_ID, AI_PLAYER_NAME, true, 'guess', `my vote: ${pick?.name ?? '?'} — that one's real`)
    }
    this.endRound('simul-done')
  }
```

`endRound` changes: guard becomes `if (!round || (this.phase.name !== 'drawing' && this.phase.name !== 'simul-vote')) return`; the reveal literal becomes:

```ts
    const reveal: RoundReveal = {
      word: round.word,
      reason,
      gains: Object.fromEntries(round.gains),
      ...(round.simul
        ? {
            simulVotes: Object.fromEntries(round.simul.voteCounts ?? []),
            aiPickId: round.simul.aiPickId ?? null,
          }
        : {}),
    }
```

`leave()` changes — replace the mid-round block with:

```ts
    if (this.round?.simul && this.phase.name === 'drawing') {
      // their drawing leaves with them; the rest keep going
      this.round.simul.submissions = this.round.simul.submissions.filter(
        (e) => e.playerId !== socketId,
      )
      const simulRound = this.round.simul
      const eligibleNow = this.humans.filter((h) => simulRound.eligible.has(h.socketId)).length
      if (!simulRound.closed && simulRound.submissions.length >= eligibleNow) {
        this.closeSubmissions()
      }
    } else if (this.round?.simul && this.phase.name === 'simul-vote') {
      const simul = this.round.simul
      simul.submissions = simul.submissions.filter((e) => e.playerId !== socketId)
      simul.votes.delete(socketId)
      // votes for the departed are void; those voters may vote again
      for (const [voter, target] of [...simul.votes]) {
        if (target === socketId) simul.votes.delete(voter)
      }
      if (this.phase.name === 'simul-vote') {
        this.phase = { ...this.phase, gallery: simul.submissions }
      }
      if (simul.submissions.length < 2) this.finishVote()
      else if (simul.votes.size >= this.humans.length) this.finishVote()
    } else if (this.round && this.phase.name === 'drawing' && this.round.drawerId === socketId) {
      this.endRound('drawer-left')
    } else if (this.round && this.phase.name === 'drawing') {
      // the departed guesser may have been the last one holding the round open
      this.maybeFinishRound()
    }
```

- [ ] **Step 5: Socket registration** — `server/src/index.ts`:

```ts
  socket.on('simul-submit', (strokes, aiTopGuess, aiConfidence) =>
    room?.simulSubmit(socket.id, strokes, String(aiTopGuess ?? ''), Number(aiConfidence) || 0),
  )
  socket.on('simul-vote', (targetId) => room?.simulVote(socket.id, String(targetId ?? '')))
```

- [ ] **Step 6: Verify** — `cd server && npm test` (all pass) and `npm run typecheck`. Client typecheck will fail on the new `RoomPhase` variant if `Room.tsx` switches exhaustively — it doesn't (it narrows by name), so `cd client && npx tsc -b` should PASS; if it doesn't, note the errors for Task 8 rather than hacking here — commit only if both typechecks pass (fold trivial client narrowing fixes in if needed).

- [ ] **Step 7: Commit** — `git commit -m "Phase 4 task 7: simultaneous mode server (submissions, vote, AI judge scoring)"`

---

### Task 8: Simultaneous mode — client ⛔ CHECKPOINT after this task

**Files:**
- Modify: `client/src/lib/strokeWire.ts`, `client/src/pages/Room.tsx`, `client/src/pages/Room.css`
- Create: `client/e2e/simul.e2e.mjs`

**Interfaces:**
- Consumes: Task 7 protocol (`SimulEntry`, `'simul-vote'` phase, `'simul-submit'`/`'simul-vote'` events, `RoundReveal.simulVotes`/`aiPickId`); `strokesToModelInput` from `lib/preprocess`; `Guesser.guess(input, k)` → `{ category, probability }[]`; `loadSharedGuesser()` (already in `Room.tsx`); `LiveCanvas({ strokes })`.
- Produces: `normalizeStrokes(strokes, canvasSize): NormPoint[][]` in `strokeWire.ts`; `SimulGallery` component (local to `Room.tsx`).

- [ ] **Step 1: normalizeStrokes** — append to `client/src/lib/strokeWire.ts`:

```ts
/** Full-drawing normalization for one-shot payloads (simultaneous mode). */
export function normalizeStrokes(strokes: Stroke[], canvasSize: number): NormPoint[][] {
  return strokes.map((s) => s.map((p) => ({ x: p.x / canvasSize, y: p.y / canvasSize, t: p.t })))
}
```

- [ ] **Step 2: Room.tsx — simul round plumbing.** Imports: add `strokesToModelInput` from `'../lib/preprocess'`, `normalizeStrokes` to the strokeWire import.

Derived state (after `roundEnd`):

```tsx
  const simulVote = phase?.name === 'simul-vote' ? phase : null
```

`meta` becomes `drawing?.round ?? roundEnd?.round ?? simulVote?.round ?? null`; add `const isSimul = meta?.modifier === 'simul'`.

Refs + callbacks (near the other stroke callbacks):

```tsx
  const simulStrokesRef = useRef<Stroke[]>([])
  const simulSubmittedRef = useRef(false)
  // joined mid-simul-round: spectate it (the server ignores late submissions anyway)
  const spectatingRoundRef = useRef(-1)
```

Detect the late join where the join ack lands — in the `<JoinScreen onJoined={...}>` callback:

```tsx
        onJoined={(id, state) => {
          setPlayerId(id)
          setRoom(state)
          if (state.phase.name === 'drawing' && state.phase.round.modifier === 'simul') {
            spectatingRoundRef.current = state.phase.round.roundIndex
          }
        }}
  const onSimulStrokes = useCallback((strokes: Stroke[]) => {
    simulStrokesRef.current = strokes // private: nothing leaves this tab until the deadline
  }, [])

  const submitSimul = useCallback(async () => {
    const canvas = canvasWrapRef.current?.querySelector('canvas')
    const size = canvas?.getBoundingClientRect().width ?? 0
    const strokes = simulStrokesRef.current
    let topGuess = ''
    let confidence = 0
    const guesser = await loadSharedGuesser()
    const input = guesser && strokes.length > 0 ? strokesToModelInput(strokes) : null
    if (guesser && input) {
      const [best] = await guesser.guess(input, 1)
      if (best) {
        topGuess = best.category
        confidence = best.probability
      }
    }
    getSocket().emit('simul-submit', size ? normalizeStrokes(strokes, size) : [], topGuess, confidence)
  }, [])
```

Auto-submit effect (next to the AI-hosting effect):

```tsx
  // simultaneous mode: draw privately, submit (with my AI's verdict) at the deadline
  useEffect(() => {
    if (drawingRoundKey < 0 || !drawing || drawing.round.modifier !== 'simul') return
    if (spectatingRoundRef.current === drawing.round.roundIndex) return
    simulSubmittedRef.current = false
    simulStrokesRef.current = []
    void loadSharedGuesser() // warm the model before the verdict is due
    const endsAt = drawing.round.endsAtMs
    const interval = setInterval(() => {
      if (simulSubmittedRef.current || Date.now() < endsAt) return
      simulSubmittedRef.current = true
      clearInterval(interval)
      void submitSimul()
    }, 200)
    return () => clearInterval(interval)
    // deps: drawingRoundKey alone — it changes exactly once per round, and re-running
    // on every room-state (scores) would reset the submitted flag mid-round
  }, [drawingRoundKey])
```

Skip normal-drawer machinery in simul: in the AI-hosting effect, change the guard to `if (drawingRoundKey < 0 || !isDrawer || drawing?.round.modifier === 'simul') return`. In `flushStrokes` add a first-line guard: `if (modifierRef.current === 'simul') return` (modifierRef exists from Task 4).

- [ ] **Step 3: Room.tsx — render.** Prompt bar: show the word to everyone in simul — change the condition `isDrawer && prompt` to `(isDrawer || isSimul) && prompt`. Canvas branch becomes:

```tsx
              {isSimul && drawing && spectatingRoundRef.current === drawing.round.roundIndex ? (
                <p className="hand-note room-simul-spectate">
                  everyone's mid-drawing — you're in from the next round
                </p>
              ) : isDrawer || (isSimul && drawing) ? (
                <>
                  <DrawingCanvas
                    onStrokesChange={isSimul ? onSimulStrokes : onStrokesChange}
                    onDrawing={isSimul ? onSimulStrokes : onDrawingStrokes}
                    clearToken={clearToken}
                    undoToken={undoToken}
                    disabled={!drawing}
                    transformPoint={isSimul ? undefined : transformFor(drawing?.round.modifier)}
                    hideInk={isSimul ? false : memoryHidden}
                  />
                  {/* existing undo button + banner + veil unchanged */}
                </>
              ) : simulVote ? null : (
                <LiveCanvas strokes={liveStrokes} />
              )}
```

Undo keyboard/button: the undo effect's guard becomes `if (drawingRoundKey < 0 || (!isDrawer && !isSimul)) return`; show the undo button when `drawing && (isDrawer || isSimul)`. ChatFeed: `canGuess={!!drawing && !isDrawer && !gotIt && !isSimul}`.

Arena section: render the gallery when voting — inside `.room-stage`, replace the canvas div content when `simulVote` is set:

```tsx
            {simulVote ? (
              <SimulGallery
                gallery={simulVote.gallery}
                meId={playerId}
                votesEndAtMs={simulVote.votesEndAtMs}
                onVote={(id) => socket.emit('simul-vote', id)}
              />
            ) : (
              /* existing .room-canvas div */
            )}
```

Also extend the arena condition: `{(drawing || roundEnd || simulVote) && meta && (...)}`, and `Countdown` shows during simul-vote too: `{(drawing || simulVote) && <Countdown endsAtMs={simulVote ? simulVote.votesEndAtMs : meta.endsAtMs} />}`.

New component at the bottom of `Room.tsx`:

```tsx
function SimulGallery({
  gallery,
  meId,
  votesEndAtMs,
  onVote,
}: {
  gallery: SimulEntry[]
  meId: string
  votesEndAtMs: number
  onVote: (playerId: string) => void
}) {
  const [votedFor, setVotedFor] = useState<string | null>(null)
  void votesEndAtMs // countdown lives in the prompt bar
  return (
    <div className="simul-gallery">
      <p className="hand-note simul-gallery-title">vote for the best one (not yours, obviously)</p>
      <div className="simul-grid">
        {gallery.map((e) => (
          <figure key={e.playerId} className="simul-entry">
            <LiveCanvas strokes={e.strokes} />
            <figcaption>
              {e.name}
              {e.playerId === meId ? ' (you)' : ''}
            </figcaption>
            <button
              className="simul-vote-btn"
              disabled={e.playerId === meId || votedFor !== null}
              onClick={() => {
                setVotedFor(e.playerId)
                onVote(e.playerId)
              }}
            >
              {votedFor === e.playerId ? 'Voted ✓' : 'Vote'}
            </button>
          </figure>
        ))}
      </div>
    </div>
  )
}
```

Imports: `type SimulEntry` from protocol. `RoundEndPanel` additions — headline map gains `'simul-done'`; extra line under the gains list:

```tsx
  const headline =
    reveal.reason === 'all-guessed'
      ? 'Everyone got it!'
      : reveal.reason === 'timeout'
        ? 'Time’s up'
        : reveal.reason === 'simul-done'
          ? 'The votes are in'
          : 'The drawer left'
```

```tsx
      {reveal.aiPickId && (
        <p className="hand-note">
          THE MACHINE backed {room.players.find((p) => p.id === reveal.aiPickId)?.name ?? '?'} (+40)
        </p>
      )}
```

`Room.css`:

```css
.simul-gallery { width: 100%; }
.simul-gallery-title { text-align: center; margin-block: 0.5rem; }
.simul-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1rem;
}
.simul-entry { border: 3px solid var(--ink, #141414); padding: 0.5rem; background: #fff; }
.simul-entry canvas { width: 100%; aspect-ratio: 1; }
.simul-vote-btn { width: 100%; margin-top: 0.4rem; }
.room-simul-spectate { display: grid; place-items: center; min-height: 200px; }
```

- [ ] **Step 4: e2e** — `client/e2e/simul.e2e.mjs`:

```js
import { assert, createAndJoin, drawLine, inkBounds, launchPair, startStack } from './harness.mjs'

// 12s draw window: enough for headless model load + two quick doodles
const stack = await startStack({ CHAOS_FORCE: 'simul', SIMUL_DRAW_MS: '12000' })
const { browser, a, b } = await launchPair()
try {
  await createAndJoin(a, b)
  await a.click('text=Start match')
  await a.waitForSelector('canvas')
  await b.waitForSelector('canvas')
  await a.waitForTimeout(3000)
  // both draw — privately (left half on A, right half on B)
  await drawLine(a, { x: 0.2, y: 0.3 }, { x: 0.2, y: 0.7 })
  await drawLine(b, { x: 0.8, y: 0.3 }, { x: 0.8, y: 0.7 })
  const bInk = await inkBounds(b)
  assert(bInk.maxX > bInk.width * 0.7 && bInk.minX > bInk.width * 0.5, 'B sees only its own ink (no relay)')
  // deadline → submissions → gallery
  await a.waitForSelector('.simul-grid', { timeout: 20_000 })
  await b.waitForSelector('.simul-grid')
  assert((await a.locator('.simul-entry').count()) === 2, 'gallery shows both drawings')
  assert((await a.locator('.chat-feed-item.is-ai').count()) >= 2, 'AI judged every canvas in the feed')
  // own vote button disabled; vote for each other
  assert(await a.locator('.simul-entry:has-text("(you)") .simul-vote-btn').isDisabled(), 'cannot vote for yourself')
  await a.locator('.simul-entry:not(:has-text("(you)")) .simul-vote-btn').click()
  await b.locator('.simul-entry:not(:has-text("(you)")) .simul-vote-btn').click()
  // all humans voted → early finish
  await a.waitForSelector('.room-panel:has-text("The votes are in")', { timeout: 10_000 })
  const panel = await a.locator('.room-panel').textContent()
  assert(panel.includes('+60') || panel.includes('+100') || panel.includes('+85'), 'vote points landed')
  console.log('simul e2e: PASS')
} finally {
  await browser.close()
  stack.stop()
}
```

Run it + all earlier e2e scripts; unit tests both packages; typecheck; lint.

- [ ] **Step 5: Commit** — `git commit -m "Phase 4 task 8: simultaneous mode client (private draw, gallery vote, AI judge)"`

- [ ] **Step 6: ⛔ CHECKPOINT — show the user** (2+ browser windows, chaos `all` or `CHAOS_FORCE=simul`; suggest `SIMUL_DRAW_MS=20000` for a quick demo round).

---

### Task 9: Regression pass + PROGRESS.md

**Files:**
- Create: `client/e2e/basic.e2e.mjs`
- Modify: `PROGRESS.md`

- [ ] **Step 1: No-chaos regression script** — `client/e2e/basic.e2e.mjs` (guards Phase 3 behavior with chaos off — no `CHAOS_FORCE`):

```js
import { assert, createAndJoin, drawLine, inkBounds, launchPair, startMatch, startStack } from './harness.mjs'

const stack = await startStack()
const { browser, a, b } = await launchPair()
try {
  await createAndJoin(a, b)
  await startMatch(a)
  assert((await a.locator('.chaos-banner').count()) === 0, 'chaos off: no banner')
  assert((await a.locator('.chaos-badge').count()) === 0, 'chaos off: no badge')
  await drawLine(a, { x: 0.3, y: 0.3 }, { x: 0.7, y: 0.7 })
  await a.waitForTimeout(600)
  const drawer = await inkBounds(a)
  const guesser = await inkBounds(b)
  assert(guesser.count > 50, 'strokes still relay')
  assert(Math.abs(drawer.minX - guesser.minX) < drawer.width * 0.1, 'no accidental transform on normal rounds')
  await b.fill('.chat-feed-input', 'zebra')
  await b.press('.chat-feed-input', 'Enter')
  await b.waitForSelector('.chat-feed-item:has-text("zebra")')
  assert(true, 'guessing still works')
  console.log('basic e2e: PASS')
} finally {
  await browser.close()
  stack.stop()
}
```

- [ ] **Step 2: Run everything** — all six e2e scripts, `npm test` in client and server, both typechecks, client lint. All must pass.

- [ ] **Step 3: Update PROGRESS.md** — check off Phase 4 in the checklist; add a "Phase 4 notes" section (modifier system architecture, per-modifier behavior + knob values, simul flow + scoring, test hooks `CHAOS_FORCE`/`SIMUL_DRAW_MS`/`?chaos=`, the committed `client/e2e/` scripts + how to run them, vitest in both packages); update "Current State" and "Next Immediate Step" (Phase 4 playtest → Phase 5 on "go"); append a Session Log entry dated 2026-07-04.

- [ ] **Step 4: Final commit** — `git commit -m "Phase 4: chaos modifiers — mirror, memory, jitter, simultaneous mode"`
