# Polish Pass (Phase 9-lite) — Design

**Date:** 2026-07-06 · **Status:** approved by user · **Scope:** mobile responsiveness,
motion polish, a11y basics. Sound: descoped (user-approved). Approach: targeted CSS + two
tiny JS touches — no layout rework, no new dependencies.

## Baseline (verified in exploration)

Already in place: pointer-event drawing with `touch-action: none`, viewport meta,
single-column collapse at 720px (`/play`) / 760px (rooms), aria labels on feeds and
read-only canvases, `role="dialog"`/`role="status"` on panels/banners, chat input at 16px
(no iOS focus-zoom).

## Changes

### A11y basics

1. **Global focus style** (`client/src/index.css`): one `:focus-visible` rule —
   `outline: 3px solid var(--acid); outline-offset: 1px` — applied to `button, a, input`.
   Remove the now-redundant local copies in `Room.css` (`.room-join-card input:focus-visible`)
   and `ChatFeed.css` (`.chat-feed-input:focus-visible`).
2. **Reduced motion**:
   - `index.css`: `@media (prefers-reduced-motion: reduce)` kill-switch — force
     `animation: none` and `transition: none` on everything (`*`).
   - `ReplayCanvas.tsx`: check `window.matchMedia('(prefers-reduced-motion: reduce)')`
     once per mount; when it matches, skip the rAF loop and paint the finished drawing
     statically (all strokes, full progress).
3. **Drawing canvas label** (`DrawingCanvas.tsx`): `aria-label="drawing canvas"` on the
   interactive canvas element.

### Mobile (≤480px pass)

4. **Prompt bars** (`Play.css`, `Room.css`): allow `flex-wrap: wrap` at ≤480px and step
   the prompt word / mask / timer down one size so long prompts fit a 390px screen.
5. **Panels & gutters**: round-end panel padding 2rem → 1.25rem at ≤480px; page paddings
   (`.play`, `.room`) tightened at ≤480px.
6. **Simul gallery**: verify the grid collapses to one column at phone width; fix if not.

### Motion polish (all disabled under reduced motion via #2)

7. **Match-end entrances**: `/play` summary and room summary sections get the existing
   200ms rise-in treatment (`play-panel-in`-style keyframes); recap `replay-card`s get a
   staggered fade-in (~60ms/card via `animation-delay`, capped at 5 cards).
8. **Score bump** (`Play.css` + `Play.tsx`): the `/play` total score does a ~150ms scale
   pop when its value changes (CSS animation re-triggered by keying the element on the
   score value).

## Out of scope

Sound, dark mode, container queries, new components, server anything.

## Verification

- Playwright screenshot sweep at 390×844: home, `/play` intro/drawing/round-end, rooms
  join/lobby (screenshots reviewed, not pixel-asserted; throwaway script in scratchpad).
- Tab-key focus check: focus ring visible on home CTAs.
- Full e2e suite stays green (all 9 scripts), both typechecks, lint.
