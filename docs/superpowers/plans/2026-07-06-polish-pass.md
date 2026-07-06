# Polish Pass (Phase 9-lite) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mobile-friendly main screens, consistent keyboard focus + reduced-motion support, and small motion polish on match-end screens — no layout rework.

**Architecture:** Targeted CSS additions to the existing per-page stylesheets plus two tiny JS touches (a `matchMedia` branch in `ReplayCanvas`, a `key` on the `/play` score value). Verification is visual (mobile-viewport Playwright screenshots reviewed by the implementer) plus the existing e2e suite.

**Tech Stack:** Plain CSS (design tokens in `client/src/index.css`), React 19, Playwright (already a client devDep).

**Spec:** `docs/superpowers/specs/2026-07-06-polish-pass-design.md`

## Global Constraints

- No new dependencies, no server changes, no layout rework.
- Focus ring: `outline: 3px solid var(--acid); outline-offset: 1px` (the existing local style, promoted).
- All new animations must be disabled by the reduced-motion kill-switch (they are, automatically — it forces `animation: none` on `*`).
- Mobile breakpoint for this pass: `max-width: 480px` (the existing 720/760px column-collapse breakpoints stay).
- Throwaway verification scripts go in the scratchpad directory, not the repo.
- All paths relative to repo root `C:\Users\hamma\Desktop\PROJECT 1`.

---

### Task 1: A11y basics (focus, reduced motion, canvas label)

**Files:**
- Modify: `client/src/index.css` (append), `client/src/pages/Room.css:100-103` (remove rule), `client/src/components/ChatFeed.css:54-57` (remove rule), `client/src/components/ReplayCanvas.tsx:23-73`, `client/src/components/DrawingCanvas.tsx:163`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: global `:focus-visible` styling and the `@media (prefers-reduced-motion: reduce)` kill-switch that Task 3's animations rely on.

- [ ] **Step 1: Global focus ring + reduced-motion kill-switch**

Append to `client/src/index.css`:

```css
/* a11y: one visible focus ring everywhere (keyboard users) */
:focus-visible {
  outline: 3px solid var(--acid);
  outline-offset: 1px;
}

/* a11y: kill decorative motion for users who ask for less of it.
   ReplayCanvas handles its own rAF loop via the same media query in JS. */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation: none !important;
    transition: none !important;
  }
}
```

Remove the now-redundant local rules:

From `client/src/pages/Room.css` delete:

```css
.room-join-card input:focus-visible {
  outline: 3px solid var(--acid);
  outline-offset: 1px;
}
```

From `client/src/components/ChatFeed.css` delete:

```css
.chat-feed-input:focus-visible {
  outline: 3px solid var(--acid);
  outline-offset: 1px;
}
```

- [ ] **Step 2: ReplayCanvas static rendering under reduced motion**

In `client/src/components/ReplayCanvas.tsx`, restructure the effect body so the per-frame paint is a named `drawAt(elapsed)` function, then branch once on the media query. Replace lines 34-72 (from `const timeline = ...` through `return () => cancelAnimationFrame(raf)`) with:

```tsx
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
```

- [ ] **Step 3: Label the interactive drawing canvas**

`client/src/components/DrawingCanvas.tsx:163` — add the aria-label:

```tsx
  return (
    <canvas
      ref={canvasRef}
      className={`drawing-canvas${disabled ? ' is-disabled' : ''}`}
      aria-label="drawing canvas"
    />
  )
```

- [ ] **Step 4: Verify with a reduced-motion browser check**

Write a throwaway script `<scratchpad>/a11y-check.e2e.mjs` (adjust the relative import to the absolute path of `client/e2e/harness.mjs`):

```js
import { chromium } from 'playwright'
import { assert, BASE, drawLine, inkBounds, startStack } from 'C:/Users/hamma/Desktop/PROJECT 1/client/e2e/harness.mjs'

const stack = await startStack()
const browser = await chromium.launch()
try {
  // 1. reduced motion: round-end replay renders statically (ink present, not animating)
  const ctx = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/play`)
  await page.click('text=Start match', { timeout: 30_000 })
  await page.waitForSelector('canvas')
  await drawLine(page, { x: 0.3, y: 0.3 }, { x: 0.7, y: 0.6 })
  await page.click('text=Give up')
  await page.waitForSelector('.play-panel .replay-canvas')
  await page.waitForTimeout(600)
  const a = (await inkBounds(page, '.play-panel .replay-canvas')).count
  await page.waitForTimeout(900)
  const b = (await inkBounds(page, '.play-panel .replay-canvas')).count
  assert(a > 0, 'reduced-motion replay shows the finished drawing')
  assert(a === b, 'reduced-motion replay does not animate')

  // 2. keyboard focus ring visible on the home CTA
  const page2 = await (await browser.newContext()).newPage()
  await page2.goto(BASE)
  await page2.keyboard.press('Tab')
  const outline = await page2.evaluate(() => {
    const el = document.activeElement
    return el ? getComputedStyle(el).outlineWidth : 'none'
  })
  assert(outline === '3px', `focused element has the 3px ring (got ${outline})`)
  console.log('a11y-check: PASS')
} finally {
  await browser.close()
  stack.stop()
}
```

Run from repo root: `node "<scratchpad>/a11y-check.e2e.mjs"`
Expected: `a11y-check: PASS`

Also run: `node client/e2e/replay-play.e2e.mjs` (normal-motion replays still animate).
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

From `client/`: `npx tsc -b` then `npx oxlint` — no errors.

```bash
git add client/src/index.css client/src/pages/Room.css client/src/components/ChatFeed.css client/src/components/ReplayCanvas.tsx client/src/components/DrawingCanvas.tsx
git commit -m "Phase 9 task 1: a11y basics (global focus ring, reduced motion, canvas label)"
```

---

### Task 2: Mobile ≤480px pass

**Files:**
- Modify: `client/src/pages/Play.css` (append), `client/src/pages/Room.css` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing downstream.

- [ ] **Step 1: Append the phone-width rules**

To `client/src/pages/Play.css`:

```css
/* phone-width pass: wrap the prompt bar, tighten gutters and panels */
@media (max-width: 480px) {
  .play {
    padding: 1.25rem 1rem 3rem;
  }

  .play-prompt-bar {
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
  }

  .play-prompt-word {
    white-space: normal;
    overflow: visible;
    text-overflow: clip;
    font-size: 1.2rem;
  }

  .play-timer {
    font-size: 1.2rem;
  }

  .play-panel {
    padding: 1.25rem;
  }
}
```

To `client/src/pages/Room.css`:

```css
/* phone-width pass: wrap the prompt bar, tighten gutters and panels */
@media (max-width: 480px) {
  .room {
    padding: 1.25rem 1rem 3rem;
  }

  .room-prompt-bar {
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
  }

  .room-prompt-word {
    white-space: normal;
    overflow: visible;
    text-overflow: clip;
    font-size: 1.2rem;
  }

  .room-prompt-mask {
    font-size: 1rem;
    letter-spacing: 0.15em;
  }

  .room-timer {
    font-size: 1.2rem;
  }

  .room-panel {
    padding: 1.25rem;
  }
}
```

Simul gallery note (spec item 6): `.simul-grid` is `repeat(auto-fit, minmax(180px, 1fr))` — at a 390px viewport two 180px columns + gap need 376px of content width and the container has ~358px, so it already collapses to one column. No change; confirmed by the math and spot-checked in the Step 2 sweep.

- [ ] **Step 2: Mobile screenshot sweep**

Write `<scratchpad>/mobile-sweep.e2e.mjs`:

```js
import { chromium } from 'playwright'
import { BASE, drawLine, startStack } from 'C:/Users/hamma/Desktop/PROJECT 1/client/e2e/harness.mjs'

const OUT = 'C:/Users/hamma/Desktop/PROJECT 1/../scratch-shots' // replace with scratchpad path
const stack = await startStack()
const browser = await chromium.launch()
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  await page.goto(BASE)
  await page.screenshot({ path: `${OUT}/home.png`, fullPage: true })
  await page.goto(`${BASE}/play`)
  await page.click('text=Start match', { timeout: 30_000 })
  await page.waitForSelector('canvas')
  await page.screenshot({ path: `${OUT}/play-drawing.png`, fullPage: true })
  await drawLine(page, { x: 0.3, y: 0.3 }, { x: 0.7, y: 0.6 })
  await page.click('text=Give up')
  await page.waitForSelector('.play-panel')
  await page.screenshot({ path: `${OUT}/play-roundend.png` })
  await page.goto(`${BASE}/rooms`)
  await page.screenshot({ path: `${OUT}/rooms-join.png`, fullPage: true })
  await page.fill('input[placeholder="doodle master"]', 'mob')
  await page.click('text=Create a room')
  await page.waitForSelector('.room-lobby')
  await page.screenshot({ path: `${OUT}/room-lobby.png`, fullPage: true })
  console.log('mobile-sweep: done')
} finally {
  await browser.close()
  stack.stop()
}
```

Run it, then **Read every screenshot** and check: nothing overflows horizontally, the prompt bar wraps instead of truncating, panels fit with comfortable padding, tap targets aren't cramped. Fix anything off before proceeding.

- [ ] **Step 3: Lint + commit**

From `client/`: `npx oxlint` — no errors (CSS untouched by oxlint but keeps the habit).

```bash
git add client/src/pages/Play.css client/src/pages/Room.css
git commit -m "Phase 9 task 2: phone-width pass for /play and rooms"
```

---

### Task 3: Motion polish (match-end entrances, recap stagger, score bump)

**Files:**
- Modify: `client/src/pages/Play.css` (append), `client/src/pages/Room.css` (append), `client/src/components/ReplayCanvas.css` (append), `client/src/pages/Play.tsx:259-262`

**Interfaces:**
- Consumes: Task 1's reduced-motion kill-switch (disables all of this automatically).
- Produces: nothing downstream.

- [ ] **Step 1: Entrance + bump CSS**

Append to `client/src/pages/Play.css` (reuses the existing `play-panel-in` keyframes):

```css
/* match summary rises in like the round panel */
.play-summary {
  animation: play-panel-in 200ms ease-out;
}

/* the total score does a little bump when points land (element is keyed on the value) */
.play-score-value {
  display: inline-block;
  animation: play-score-bump 180ms ease-out;
}

@keyframes play-score-bump {
  40% {
    transform: scale(1.18);
  }
}
```

Append to `client/src/pages/Room.css` (reuses the existing `room-panel-in` keyframes):

```css
/* match summary rises in like the round panel */
.room-summary {
  animation: room-panel-in 200ms ease-out;
}
```

Append to `client/src/components/ReplayCanvas.css` (recap grids in both modes):

```css
/* recap cards fade up with a small stagger */
.play-recap li,
.room-recap li {
  animation: replay-card-in 300ms ease-out backwards;
}
.play-recap li:nth-child(2),
.room-recap li:nth-child(2) {
  animation-delay: 60ms;
}
.play-recap li:nth-child(3),
.room-recap li:nth-child(3) {
  animation-delay: 120ms;
}
.play-recap li:nth-child(4),
.room-recap li:nth-child(4) {
  animation-delay: 180ms;
}
.play-recap li:nth-child(5),
.room-recap li:nth-child(5) {
  animation-delay: 240ms;
}

@keyframes replay-card-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
```

- [ ] **Step 2: Key the score value in `Play.tsx`**

`client/src/pages/Play.tsx:259-262` — key the value span on the score so React remounts it and the bump re-triggers:

```tsx
          <div className="play-score" aria-label="total score">
            <span className="play-score-label">score</span>
            <span className="play-score-value" key={totalScore}>
              {totalScore}
            </span>
          </div>
```

- [ ] **Step 3: Verify, typecheck, lint**

Run from repo root: `node client/e2e/replay-play.e2e.mjs` (summary + recap still render and animate under the new CSS).
Expected: PASS.

From `client/`: `npx tsc -b` then `npx oxlint` — no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/Play.css client/src/pages/Room.css client/src/components/ReplayCanvas.css client/src/pages/Play.tsx
git commit -m "Phase 9 task 3: motion polish (summary entrances, recap stagger, score bump)"
```

---

### Task 4: Full regression + PROGRESS.md

**Files:**
- Modify: `PROGRESS.md`

- [ ] **Step 1: Unit, typecheck, lint sweep**

- From `client/`: `npx vitest run` — all green.
- From `server/`: `npm test` and `npm run typecheck` — all green.
- From `client/`: `npx tsc -b` and `npx oxlint` — no errors.

- [ ] **Step 2: Full e2e suite (all 9 scripts)**

From repo root, expect PASS from each:

```bash
node client/e2e/basic.e2e.mjs
node client/e2e/chaos-level.e2e.mjs
node client/e2e/mirror.e2e.mjs
node client/e2e/memory.e2e.mjs
node client/e2e/jitter.e2e.mjs
node client/e2e/play-chaos.e2e.mjs
node client/e2e/simul.e2e.mjs
node client/e2e/replay-play.e2e.mjs
node client/e2e/replay-room.e2e.mjs
```

- [ ] **Step 3: Update PROGRESS.md**

- Check the Phase 9 checklist box (note "lite" scope delivered).
- Add a short "Phase 9 notes (what was built)" section: global focus ring, reduced-motion
  (CSS kill-switch + static ReplayCanvas), drawing-canvas label, ≤480px pass for both arenas,
  match-end entrances + recap stagger + score bump.
- Update "Next Immediate Step" (next: Phase 10 — README + Render deploy).
- Add a session-log line.

- [ ] **Step 4: Commit**

```bash
git add PROGRESS.md
git commit -m "Phase 9 complete: polish pass (mobile, motion, a11y basics)"
```
