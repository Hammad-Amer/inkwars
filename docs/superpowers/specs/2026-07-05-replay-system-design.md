# Phase 5 — Replay System Design

**Date:** 2026-07-05
**Status:** Approved by user
**Master prompt requirement:** store strokes as vectors (done since Phase 2/3); after each
round, auto-generate a smooth animated replay of how the drawing was built, playable inline.

## Scope (user-approved)

- Animated replays at **round-end** (both `/play` and multiplayer rooms) and in a
  **match-end recap** (card per round, rewatchable).
- **Auto-loop, fixed duration**: every replay compresses to ~4s, plays automatically,
  loops forever with a short hold on the finished drawing. No player controls.
- **Pure client-side**: replays derive entirely from stroke data each client already holds
  when a round ends (drawer: local strokes; guessers: relayed `liveStrokes`; simul: gallery
  entries). No protocol changes, no server storage. Persistent/shareable replays are a
  Phase 7+ concern.
- Out of scope: sharing/export, scrubbing/speed controls, replaying undone strokes,
  recap entries for rounds a late joiner never saw.

## Architecture

Three pieces, all client-side:

```
lib/replay.ts            pure time-compression math + constants   (vitest)
components/ReplayCanvas  rAF playback of a compressed timeline    (e2e)
Play.tsx / Room.tsx      archive strokes at round end, render     (e2e)
```

### 1. Time compression — `client/src/lib/replay.ts`

`buildReplayTimeline(strokes: NormPoint[][], durationMs = REPLAY_DURATION_MS): NormPoint[][]`

Pure function; returns the same shape with remapped `t` values spanning exactly
`0..durationMs`:

1. Walk strokes in order. Within a stroke, keep each point's time offset relative to the
   stroke start (pen rhythm preserved).
2. Cap the gap between one stroke's end and the next stroke's start at
   `REPLAY_GAP_CAP_MS` (400) of raw time — thinking pauses collapse, the drawing's beat
   survives.
3. Linearly scale the compressed timeline so the final point lands at `durationMs`.

Degenerate inputs are explicit: empty input → empty output; a single point or a
zero-time-span drawing maps everything to `t = 0` (the finished drawing just shows for the
whole loop). Output timestamps are non-decreasing in drawing order.

Undo is already handled upstream: the archived stroke list is post-undo, so replays show a
clean history of the strokes that survived.

Constants (module-level, exported): `REPLAY_DURATION_MS = 4000`,
`REPLAY_LOOP_PAUSE_MS = 700`, `REPLAY_GAP_CAP_MS = 400`.

### 2. Playback — `client/src/components/ReplayCanvas.tsx`

Imperative canvas driven by `requestAnimationFrame`, same conventions as `LiveCanvas`
(square canvas, devicePixelRatio-aware, ink stroke style scaled to canvas size).

- Props: `strokes: NormPoint[][]` (normalized 0..1 coords — raw, not pre-compressed;
  the component calls `buildReplayTimeline` itself), optional `durationMs`.
- Each frame renders every point with remapped `t ≤ elapsed`; the tip of the in-progress
  stroke interpolates within its current segment so growth is smooth at any frame rate.
- On completion, hold the finished drawing `REPLAY_LOOP_PAUSE_MS`, then restart.
- Restarts from zero when the `strokes` prop identity changes; rAF cancelled on unmount.

### 3. Integration

**`/play` (Play.tsx):**
- A ref keeps the current round's strokes (the `onStrokes` callback already receives the
  live `Stroke[]`; capture the latest). At round close, normalize by the canvas CSS size
  and stash into the round's result entry (`RoundResult` gains `strokes: NormPoint[][]`).
- `RoundEndPanel` renders `<ReplayCanvas>` above the score line.
- `MatchSummary` renders a card grid: one card per round — word, points, small looping
  replay.

**Multiplayer (Room.tsx):**
- When `phase` flips to `round-end`, archive `{ roundIndex, word, drawerName, strokes }`
  into a match-scoped ref (`Map<number, ArchivedRound>`):
  - drawer: normalize local px strokes by canvas size (`normalizeStrokes`, exists);
  - guessers: `liveStrokes` (already normalized; still intact at round-end — it only
    clears when the next round starts);
  - simul rounds: the vote winner's gallery entry (most votes; tie → earliest in gallery
    order). If the reveal carries no votes (e.g. `simul-done` with < 2 submissions),
    archive nothing for that round.
- `RoundEndPanel` plays the archived drawing for the revealed round.
- Match-end panel renders the recap card grid from the archive (word, drawer name,
  replay). The archive resets when a new match starts. Late joiners get cards only for
  rounds they witnessed.

## Error handling

- Empty stroke list (nobody drew): round-end shows the panel without a replay canvas,
  and the recap skips that round's card entirely.
- Strokes with missing/absurd timestamps have already been sanitized on the multiplayer
  wire (Phase 4 `sanitizeStrokes`) and are trusted from the local canvas.

## Testing

- **Unit (vitest, client):** `buildReplayTimeline` — output spans exactly `durationMs`;
  inter-stroke gaps capped; intra-stroke rhythm preserved (proportions of point offsets
  unchanged within a stroke); timestamps non-decreasing; empty/single-point/zero-span
  inputs.
- **e2e (`client/e2e/replay.e2e.mjs`):**
  - `/play`: draw, give up → round-end panel shows a replay canvas whose ink count
    *changes* between two samples (proves animation), then complete the match → recap
    cards present and animating.
  - Multiplayer: server gains env hook `ROUND_DURATION_MS` (test-only, mirrors
    `SIMUL_DRAW_MS`) to shorten rounds; draw, let the round time out → both clients'
    round-end panels show an animated replay.
- All existing e2e scripts, unit tests, typechecks, lint stay green.

## Server changes

Exactly one, test-only: `ROUND_DURATION_MS` env override in `server/src/room.ts`, same
pattern as the existing `simulDrawMs()` helper.
