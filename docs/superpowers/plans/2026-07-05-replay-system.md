# Phase 5 — Replay System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-looping ~4s animated replays of each round's drawing, shown in the round-end panel and a match-end recap, on both `/play` and multiplayer rooms — per the approved spec at `docs/superpowers/specs/2026-07-05-replay-system-design.md`.

**Architecture:** Pure client-side. A pure `buildReplayTimeline` function compresses raw stroke timestamps (intra-stroke rhythm kept, inter-stroke gaps capped, scaled to a fixed clip length); a rAF-driven `ReplayCanvas` component plays the compressed timeline on a loop; `Play.tsx` and `Room.tsx` archive each round's strokes (which every client already holds at round end) and render replays at round-end and match-end. The only server change is a test-only `ROUND_DURATION_MS` env hook.

**Tech Stack:** Existing React 19 + TS + Vite client, vitest (client), committed Playwright e2e scripts in `client/e2e/`.

## Global Constraints

- No paid APIs; all client-side (project rule).
- Strokes stay vectors end-to-end; wire coordinates are normalized 0..1 (`NormPoint` = `{x, y, t}`, `t` = ms since drawing start).
- Constants (spec): `REPLAY_DURATION_MS = 4000`, `REPLAY_LOOP_PAUSE_MS = 700`, `REPLAY_GAP_CAP_MS = 400` — defined once in `client/src/lib/replay.ts`.
- Empty drawings: round-end panel omits the replay canvas; the room recap skips the round's card entirely. (`/play`'s summary keeps one card per round for scores; it just has no canvas for empty rounds.)
- Simul rounds archive the vote winner (most votes; tie → earliest gallery entry); a simul round that never reached a gallery archives nothing.
- Design tokens: paper `#F5F2EA`, ink `#141414`, acid `#E8FF3C`; Archivo (display), Caveat (`.hand-note`), Space Mono (numbers). Match existing comment style: explanatory block comments about *why*, no play-by-play.
- Typecheck: `cd client && npx tsc -b` and `cd server && npm run typecheck`. Lint: `cd client && npm run lint`. Unit tests: `npm test` in each package.
- Existing test hooks stay; new (this phase): server env `ROUND_DURATION_MS` shortens normal rounds (mirrors `SIMUL_DRAW_MS`).
- E2E scripts run from repo root: `node client/e2e/<name>.e2e.mjs`; they spawn the full stack themselves (vite on :5199, server on :3001).

---

### Task 1: Timeline compression — `lib/replay.ts`

**Files:**
- Create: `client/src/lib/replay.ts`
- Create: `client/src/lib/replay.test.ts`

**Interfaces:**
- Consumes: `NormPoint` from `shared/protocol`.
- Produces: `buildReplayTimeline(strokes: NormPoint[][], durationMs?: number): NormPoint[][]`; constants `REPLAY_DURATION_MS = 4000`, `REPLAY_LOOP_PAUSE_MS = 700`, `REPLAY_GAP_CAP_MS = 400`. Output: same stroke shape, timestamps remapped to span exactly `0..durationMs`, non-decreasing in drawing order; empty strokes dropped.

- [ ] **Step 1: Write the failing tests** — `client/src/lib/replay.test.ts`:

```ts
import { expect, test } from 'vitest'
import { buildReplayTimeline, REPLAY_GAP_CAP_MS } from './replay'
import type { NormPoint } from '../../../shared/protocol'

const pt = (t: number): NormPoint => ({ x: 0.5, y: 0.5, t })

test('empty input stays empty', () => {
  expect(buildReplayTimeline([], 4000)).toEqual([])
  expect(buildReplayTimeline([[]], 4000)).toEqual([])
})

test('single dot and zero-time-span drawings land entirely at t=0', () => {
  expect(buildReplayTimeline([[pt(1234)]], 4000)[0][0].t).toBe(0)
  const out = buildReplayTimeline([[pt(500), pt(500)]], 4000)
  expect(out[0].map((p) => p.t)).toEqual([0, 0])
})

test('timeline spans exactly durationMs and starts at 0', () => {
  const out = buildReplayTimeline([[pt(0), pt(100)], [pt(9000), pt(9500)]], 4000)
  expect(out[0][0].t).toBe(0)
  expect(out[1][1].t).toBe(4000)
})

test('inter-stroke gaps are capped, intra-stroke rhythm preserved', () => {
  // stroke 1 takes 300ms; a 20s thinking pause; stroke 2 takes 300ms.
  // compressed raw timeline: 300 + 400 (capped gap) + 300 = 1000 → scale ×4
  const out = buildReplayTimeline(
    [[pt(0), pt(100), pt(300)], [pt(20_300), pt(20_600)]],
    4000,
  )
  expect(REPLAY_GAP_CAP_MS).toBe(400)
  expect(out[0].map((p) => p.t)).toEqual([0, 400, 1200])
  expect(out[1].map((p) => p.t)).toEqual([2800, 4000])
})

test('timestamps are non-decreasing even for disordered raw data', () => {
  const out = buildReplayTimeline(
    [[pt(0), pt(100), pt(50)], [pt(40), pt(90)], [pt(5000), pt(5001)]],
    4000,
  )
  const flat = out.flat().map((p) => p.t)
  for (let i = 1; i < flat.length; i++) expect(flat[i]).toBeGreaterThanOrEqual(flat[i - 1])
})
```

- [ ] **Step 2: Run to verify failure** — `cd client && npm test` → FAIL (cannot resolve `./replay`).

- [ ] **Step 3: Implement** — `client/src/lib/replay.ts`:

```ts
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
```

- [ ] **Step 4: Run tests** — `cd client && npm test` → all PASS (including the existing chaos tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/replay.ts client/src/lib/replay.test.ts
git commit -m "Phase 5 task 1: replay timeline compression (gap-capped, fixed clip length)"
```

---

### Task 2: Playback — `ReplayCanvas` component

**Files:**
- Create: `client/src/components/ReplayCanvas.tsx`
- Create: `client/src/components/ReplayCanvas.css`
- Modify: `client/e2e/harness.mjs` (inkBounds selector param — test infra for Tasks 3–4)

**Interfaces:**
- Consumes: `buildReplayTimeline`, `REPLAY_DURATION_MS`, `REPLAY_LOOP_PAUSE_MS` (Task 1); `NormPoint`.
- Produces: default-export component `ReplayCanvas({ strokes, durationMs? }: { strokes: NormPoint[][]; durationMs?: number })` rendering `<canvas className="replay-canvas">`; CSS classes `.replay-canvas` and `.replay-card` (shared card styling used by both pages); harness `inkBounds(page, selector = 'canvas')`.

- [ ] **Step 1: Component** — `client/src/components/ReplayCanvas.tsx`:

```tsx
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

    const frame = () => {
      // past durationMs the finished drawing holds until the loop restarts
      const elapsed = Math.min((performance.now() - startedAt) % cycleMs, durationMs)
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
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [strokes, durationMs])

  return <canvas ref={canvasRef} className="replay-canvas" aria-label="drawing replay" />
}
```

- [ ] **Step 2: CSS** — `client/src/components/ReplayCanvas.css`:

```css
.replay-canvas {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  background: #fff;
  border: 2px solid var(--ink, #141414);
}

/* shared recap-card styling (used by /play summary and the room recap) */
.replay-card {
  margin: 0;
  border: 3px solid var(--ink, #141414);
  background: #fff;
  padding: 0.5rem;
}
.replay-card .replay-canvas {
  border: none;
}
.replay-card figcaption {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;
  margin-top: 0.35rem;
  font-size: 0.85rem;
}
```

- [ ] **Step 3: Harness selector param** — in `client/e2e/harness.mjs`, change the `inkBounds` signature and locator line (the `evaluate` body is unchanged):

```js
/** Inked-pixel bounding box + count on the page's first matching canvas, CSS px. */
export async function inkBounds(page, selector = 'canvas') {
  return page.locator(selector).first().evaluate((canvas) => {
```

(Default keeps every existing e2e script working unmodified.)

- [ ] **Step 4: Verify** — `cd client && npx tsc -b` → PASS; `npm run lint` → clean; `node client/e2e/basic.e2e.mjs` → PASS (proves the harness change broke nothing; the component itself is exercised by Tasks 3–4 e2e).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/ReplayCanvas.tsx client/src/components/ReplayCanvas.css client/e2e/harness.mjs
git commit -m "Phase 5 task 2: ReplayCanvas (rAF loop, interpolated tip)"
```

---

### Task 3: `/play` integration ⛔ CHECKPOINT after this task

**Files:**
- Modify: `client/src/pages/Play.tsx`, `client/src/pages/Play.css`
- Create: `client/e2e/replay-play.e2e.mjs`

**Interfaces:**
- Consumes: `ReplayCanvas` (Task 2), `normalizeStrokes(strokes, canvasSize)` from `lib/strokeWire`, `NormPoint`.
- Produces: `RoundResult.strokes: NormPoint[][]` (Play-local type); CSS `.play-panel-replay`, `.play-recap`.

- [ ] **Step 1: Play.tsx wiring.** Imports — add:

```tsx
import type { NormPoint } from '../../../shared/protocol'
import ReplayCanvas from '../components/ReplayCanvas'
import { normalizeStrokes } from '../lib/strokeWire'
```

(`MEMORY_HIDE_AFTER_MS` is already imported from protocol; keep that import line and add the type import separately or merge — merged form: `import { MEMORY_HIDE_AFTER_MS, type NormPoint } from '../../../shared/protocol'`.)

`RoundResult` gains the drawing:

```ts
interface RoundResult {
  prompt: Prompt
  points: number
  /** null = time ran out */
  guessedAtMs: number | null
  /** normalized final drawing, for the replay */
  strokes: NormPoint[][]
}
```

New refs next to the existing ones:

```tsx
  const latestStrokesRef = useRef<Stroke[]>([])
  const playCanvasRef = useRef<HTMLDivElement>(null)
```

First line of `onStrokes`: `latestStrokesRef.current = strokes`. In `startRound`, next to `setClearToken((n) => n + 1)`: `latestStrokesRef.current = []`.

In `closeRound`, capture the drawing when building the result:

```tsx
    const canvas = playCanvasRef.current?.querySelector('canvas')
    const size = canvas?.getBoundingClientRect().width ?? 0
    const result: RoundResult = {
      prompt,
      guessedAtMs,
      points: guessedAtMs === null ? 0 : scoreFor(prompt, guessedAtMs),
      strokes: size ? normalizeStrokes(latestStrokesRef.current, size) : [],
    }
```

Attach the ref: `<div className="play-canvas" ref={playCanvasRef}>`.

- [ ] **Step 2: Round-end panel replay.** In `RoundEndPanel`, after the `<h2>`:

```tsx
      {result.strokes.length > 0 && (
        <div className="play-panel-replay">
          <ReplayCanvas strokes={result.strokes} />
        </div>
      )}
```

- [ ] **Step 3: Match-end recap.** In `MatchSummary`, replace the `<ol className="play-summary-rounds">…</ol>` block with:

```tsx
      <ol className="play-recap">
        {results.map((r, i) => (
          <li key={i}>
            <figure className="replay-card">
              {r.strokes.length > 0 && <ReplayCanvas strokes={r.strokes} />}
              <figcaption>
                <span className="play-summary-word">{r.prompt.name}</span>
                <span className="play-summary-time hand-note">
                  {r.guessedAtMs === null ? 'missed' : `${(r.guessedAtMs / 1000).toFixed(1)}s`}
                </span>
                <span className="play-summary-points">+{r.points}</span>
              </figcaption>
            </figure>
          </li>
        ))}
      </ol>
```

- [ ] **Step 4: Play.css.** Replace the `.play-summary-rounds` rules (list + row styling — the card now owns row layout) with:

```css
.play-panel-replay {
  width: 180px;
  margin: 0.75rem auto;
}

.play-recap {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1rem;
  list-style: none;
  padding: 0;
  margin-block: 1.5rem;
  width: min(100%, 640px);
}
```

Keep any `.play-summary-word` / `.play-summary-time` / `.play-summary-points` font rules that still apply inside the card captions; delete rules that only made sense for the old `<li>` rows (e.g. flex row layout, borders between rows).

- [ ] **Step 5: e2e** — `client/e2e/replay-play.e2e.mjs`:

```js
import { chromium } from 'playwright'
import { assert, BASE, drawLine, inkBounds, startStack } from './harness.mjs'

/** A replay canvas is animating iff its ink count changes across samples. */
async function animates(page, selector) {
  const counts = new Set()
  for (let i = 0; i < 8; i++) {
    counts.add((await inkBounds(page, selector)).count)
    await page.waitForTimeout(350)
  }
  return counts.size > 1
}

const stack = await startStack()
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.goto(`${BASE}/play`)
  await page.click('text=Start match', { timeout: 30_000 }) // waits out model load
  await page.waitForSelector('canvas')
  await drawLine(page, { x: 0.3, y: 0.3 }, { x: 0.7, y: 0.6 })
  await page.click('text=Give up')
  await page.waitForSelector('.play-panel')
  assert((await page.locator('.play-panel .replay-canvas').count()) === 1, 'round-end panel shows a replay')
  assert(await animates(page, '.play-panel .replay-canvas'), 'round-end replay animates')
  // rounds 2-5: give up without drawing — empty rounds get no replay canvas
  for (let round = 2; round <= 5; round++) {
    await page.click('text=Next round')
    await page.waitForSelector('text=Give up')
    await page.click('text=Give up')
    if (round < 5) {
      await page.waitForSelector('.play-panel')
      if (round === 2) {
        assert(
          (await page.locator('.play-panel .replay-canvas').count()) === 0,
          'no replay when nothing was drawn',
        )
      }
    }
  }
  await page.waitForSelector('.play-summary')
  assert(
    (await page.locator('.play-summary .replay-canvas').count()) === 1,
    'recap shows a replay only for the drawn round',
  )
  assert(await animates(page, '.play-summary .replay-canvas'), 'recap replay animates')
  console.log('replay-play e2e: PASS')
} finally {
  await browser.close()
  stack.stop()
}
```

- [ ] **Step 6: Verify** — from repo root: `node client/e2e/replay-play.e2e.mjs` → all `ok` + PASS. Also `node client/e2e/play-chaos.e2e.mjs` (regression: same page), `cd client && npm test`, `npx tsc -b`, `npm run lint`.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/Play.tsx client/src/pages/Play.css client/e2e/replay-play.e2e.mjs
git commit -m "Phase 5 task 3: /play round-end replay + match recap"
```

- [ ] **Step 8: ⛔ CHECKPOINT — show the user.** Tell them: `cd client && npm run dev`, open `/play`, draw a round and give up or let the AI guess — the round-end panel replays the drawing; finish the match for the recap grid. Wait for their verdict before Task 4.

---

### Task 4: Multiplayer integration ⛔ CHECKPOINT after this task

**Files:**
- Modify: `client/src/pages/Room.tsx`, `client/src/pages/Room.css`
- Modify: `server/src/room.ts` (test-only env hook)
- Create: `client/e2e/replay-room.e2e.mjs`

**Interfaces:**
- Consumes: `ReplayCanvas` (Task 2), `normalizeStrokes` (exists), `StrokeStore.visibleStrokes()` (exists), `RoundReveal.simulVotes` (exists), harness (Task 2 version).
- Produces: `ArchivedRound { roundIndex, word, drawerName, strokes }` (Room-local type); `RoundEndPanel` prop `replay: NormPoint[][] | null`; `MatchEnd` prop `recap: ArchivedRound[]`; server `roundDurationMs()` env hook; CSS `.room-panel-replay`, `.room-recap`.

- [ ] **Step 1: Server env hook** — in `server/src/room.ts`, next to the existing `simulDrawMs()` helper:

```ts
/** e2e hook: ROUND_DURATION_MS env shortens normal rounds */
function roundDurationMs(): number {
  return Number(process.env.ROUND_DURATION_MS ?? 0) || ROUND_DURATION_MS
}
```

In `startRound`, change `const durationMs = isSimul ? simulDrawMs() : ROUND_DURATION_MS` to `const durationMs = isSimul ? simulDrawMs() : roundDurationMs()`. (Scoring math still uses the real `ROUND_DURATION_MS` constant — fine for a test hook.) Run `cd server && npm run typecheck && npm test` → PASS.

- [ ] **Step 2: Room.tsx — archive plumbing.** Imports: add `import ReplayCanvas from '../components/ReplayCanvas'`. Module-scope type (next to the constants at the top):

```ts
/** one finished round's drawing, kept client-side for replays (Phase 5) */
interface ArchivedRound {
  roundIndex: number
  word: string
  drawerName: string
  strokes: NormPoint[][]
}
```

New refs next to `spectatingRoundRef`:

```tsx
  const archiveRef = useRef(new Map<number, ArchivedRound>())
  const drawerStrokesRef = useRef<Stroke[]>([])
  const galleryRef = useRef<SimulEntry[]>([])
```

Keep the drawer's latest strokes: add `drawerStrokesRef.current = strokes` as the first line of both `onStrokesChange` and `onDrawingStrokes`.

In `onRoomState`, inside the new-round housekeeping block (with the store clear), add:

```tsx
        drawerStrokesRef.current = []
        if (state.phase.round.roundIndex === 0) archiveRef.current.clear() // new match
```

Still in `onRoomState`, before `setRoom(state)` (order matters — the archive must exist when the round-end render happens), add:

```tsx
      if (state.phase.name === 'simul-vote') galleryRef.current = state.phase.gallery
      if (state.phase.name === 'round-end' && !archiveRef.current.has(state.phase.round.roundIndex)) {
        const { round, reveal } = state.phase
        if (round.modifier === 'simul') {
          // the recap keeps the round's vote winner (tie → earliest gallery entry)
          const gallery = galleryRef.current
          if (gallery.length > 0) {
            const votes = reveal.simulVotes ?? {}
            let winner = gallery[0]
            for (const e of gallery) {
              if ((votes[e.playerId] ?? 0) > (votes[winner.playerId] ?? 0)) winner = e
            }
            archiveRef.current.set(round.roundIndex, {
              roundIndex: round.roundIndex,
              word: reveal.word,
              drawerName: winner.name,
              strokes: winner.strokes,
            })
          }
          galleryRef.current = []
        } else {
          // drawer holds the original px strokes; everyone else has the relayed vectors
          let strokes: NormPoint[][] = []
          if (round.drawerId === s.id) {
            const size = canvasWrapRef.current?.querySelector('canvas')?.getBoundingClientRect().width ?? 0
            if (size) strokes = normalizeStrokes(drawerStrokesRef.current, size)
          } else {
            strokes = storeRef.current.visibleStrokes()
          }
          if (strokes.length > 0) {
            archiveRef.current.set(round.roundIndex, {
              roundIndex: round.roundIndex,
              word: reveal.word,
              drawerName: state.players.find((p) => p.id === round.drawerId)?.name ?? '?',
              strokes,
            })
          }
        }
      }
```

- [ ] **Step 3: Room.tsx — render.** `RoundEndPanel` call site gains:

```tsx
              replay={archiveRef.current.get(roundEnd.round.roundIndex)?.strokes ?? null}
```

`RoundEndPanel` signature adds `replay: NormPoint[][] | null`; render after the "The word was" line:

```tsx
      {replay && replay.length > 0 && (
        <div className="room-panel-replay">
          <ReplayCanvas strokes={replay} />
        </div>
      )}
```

`MatchEnd` call site gains:

```tsx
          recap={[...archiveRef.current.values()].sort((a, b) => a.roundIndex - b.roundIndex)}
```

`MatchEnd` signature adds `recap: ArchivedRound[]`; render between the team totals and the player list:

```tsx
      {recap.length > 0 && (
        <ol className="room-recap" aria-label="round replays">
          {recap.map((r) => (
            <li key={r.roundIndex}>
              <figure className="replay-card">
                <ReplayCanvas strokes={r.strokes} />
                <figcaption>
                  <span>{r.word}</span>
                  <span className="hand-note">{r.drawerName}</span>
                </figcaption>
              </figure>
            </li>
          ))}
        </ol>
      )}
```

- [ ] **Step 4: Room.css** additions:

```css
.room-panel-replay {
  width: 180px;
  margin: 0.75rem auto;
}

.room-recap {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1rem;
  list-style: none;
  padding: 0;
  margin-block: 1.5rem;
  width: min(100%, 640px);
}
```

- [ ] **Step 5: e2e** — `client/e2e/replay-room.e2e.mjs` (4s rounds; with 2 humans the match is 4 rounds, so match-end lands within ~40s):

```js
import { assert, createAndJoin, drawLine, inkBounds, launchPair, startMatch, startStack } from './harness.mjs'

/** A replay canvas is animating iff its ink count changes across samples. */
async function animates(page, selector) {
  const counts = new Set()
  for (let i = 0; i < 8; i++) {
    counts.add((await inkBounds(page, selector)).count)
    await page.waitForTimeout(350)
  }
  return counts.size > 1
}

const stack = await startStack({ ROUND_DURATION_MS: '4000' })
const { browser, a, b } = await launchPair()
try {
  await createAndJoin(a, b)
  await startMatch(a)
  // Alice (round-1 drawer) draws; the round times out at 4s
  await drawLine(a, { x: 0.3, y: 0.3 }, { x: 0.7, y: 0.6 })
  await a.waitForSelector('.room-panel', { timeout: 15_000 })
  assert((await a.locator('.room-panel .replay-canvas').count()) === 1, 'drawer sees the round replay')
  assert((await b.locator('.room-panel .replay-canvas').count()) === 1, 'guesser sees the round replay')
  assert(await animates(b, '.room-panel .replay-canvas'), 'guesser replay animates')
  // nobody draws rounds 2-4; recap should hold exactly the one real drawing
  await a.waitForSelector('.room-summary', { timeout: 90_000 })
  assert((await a.locator('.room-summary .replay-canvas').count()) === 1, 'recap card only for the drawn round')
  assert(await animates(a, '.room-summary .replay-canvas'), 'recap replay animates')
  console.log('replay-room e2e: PASS')
} finally {
  await browser.close()
  stack.stop()
}
```

- [ ] **Step 6: Verify** — `node client/e2e/replay-room.e2e.mjs` → PASS. Regressions: `node client/e2e/basic.e2e.mjs` and `node client/e2e/simul.e2e.mjs` (both touch Room.tsx paths). Both typechecks, client lint, both `npm test`.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/Room.tsx client/src/pages/Room.css server/src/room.ts client/e2e/replay-room.e2e.mjs
git commit -m "Phase 5 task 4: multiplayer round replays + match recap"
```

- [ ] **Step 8: ⛔ CHECKPOINT — show the user.** Tell them: start both dev servers, two browser windows on `/rooms`, play a round — the reveal panel replays the drawing on every client, and match-end shows the recap wall. Wait for their verdict before Task 5.

---

### Task 5: Regression pass + PROGRESS.md

**Files:**
- Modify: `PROGRESS.md`

- [ ] **Step 1: Run everything** — all 9 e2e scripts (`basic`, `chaos-level`, `mirror`, `memory`, `jitter`, `play-chaos`, `simul`, `replay-play`, `replay-room`), `npm test` in client and server, both typechecks, client lint. All must pass.

- [ ] **Step 2: Update PROGRESS.md** — check off Phase 5 in the checklist; add a "Phase 5 notes" section (timeline compression algorithm + constants, ReplayCanvas behavior, where replays appear, the archive design incl. simul-winner rule and the round-0 reset, `ROUND_DURATION_MS` test hook, the two new e2e scripts); update "Current State" and "Next Immediate Step" (Phase 5 playtest → Phase 6 WebLLM commentary on "go"); append a Session Log entry dated 2026-07-05.

- [ ] **Step 3: Final commit + push**

```bash
git add -A
git commit -m "Phase 5: replay system — animated round replays + match recaps"
git push
```
