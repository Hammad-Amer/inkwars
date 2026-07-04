# Phase 4 — Chaos Modifiers: Design

**Date:** 2026-07-04 · **Status:** approved by user · **Builds on:** Phase 2 (`/play`) and Phase 3 (multiplayer rooms)

Four chaos modifiers from the master spec: mirrored canvas, memory draw, non-dominant-hand
mode, and simultaneous mode. Implemented **one at a time** in this order — mirror → memory →
jitter → simul — each shown to the user before the next begins.

## Decisions made with the user (2026-07-04)

1. **Scope:** modifiers ship in multiplayer rooms; `/play` also gets the three canvas
   modifiers (mirror, memory, jitter) via a chaos toggle on its setup — when on, it behaves
   like the `some` level: each round after the first has a 40% chance of a random canvas
   modifier. Simul is multiplayer-only by nature.
2. **Selection:** host sets a lobby chaos level — `off` / `some` (~40% of rounds) / `all`
   (every round). The **server** rolls and picks the modifier; a short reveal moment
   announces it before drawing starts.
3. **Non-dominant-hand mode** is implemented as **jitter**: a smooth wobble injected into the
   drawer's pen input. Enforceable and equal for everyone (honor-system rejected as
   unverifiable in multiplayer).
4. **Simultaneous mode:** the AI **judges** — it does not draw. Private drawing, gallery
   reveal, human vote + AI vote with a comment line. (Live spectator grid and AI-as-contestant
   rejected for scope; grid noted as possible Phase 9 polish.)

## Architecture (approach A — chosen over server-enforced effects)

The server picks and broadcasts the modifier; **effects run at the drawer's client**:

- **Mirror** and **jitter** transform pen points **at input capture**. The stored, relayed,
  AI-observed, and (Phase 5) replayed strokes are simply the real drawing — no protocol or
  consumer changes anywhere downstream.
- **Memory** only hides the drawer's local display; the stroke data and everyone else's view
  are untouched.
- Rationale: server-side stroke transformation was rejected — it breaks the
  drawer-renders-locally model, adds latency to purely visual effects, and cheat-proofing
  one's own handicap in a friends game is already deferred to Phase 10 hardening.

## Protocol changes (`shared/protocol.ts`)

```ts
type ChaosModifier = 'mirror' | 'memory' | 'jitter' | 'simul'
type ChaosLevel = 'off' | 'some' | 'all'
```

- `RoundMeta.modifier: ChaosModifier | null`
- `RoomState.chaosLevel: ChaosLevel` (lobby UI shows/controls it)
- Client→server: `set-chaos(level)` — host only, lobby only
- Simul additions listed in the simul section below.

## Server modifier roll (`server/src/room.ts`)

At `startRound`: round 1 of a match is always `null` (matches open readable). Otherwise
`off` → never; `some` → 40% chance; `all` → always. Pick uniformly from the four, except:
never the same modifier twice in a row, and `simul` only with ≥2 human players. Announce via
a system feed entry; clients render a chaos banner during the round intro plus a persistent
badge during the round (late joiners understand what they're seeing).

## The three canvas modifiers

`DrawingCanvas` grows two props, staying dumb: `transformPoint?: (p: StrokePoint) =>
StrokePoint` and `hideInk?: boolean`. Pages (`Play.tsx`, `Room.tsx`) supply them from the
round's modifier.

- **Mirror** — drawer's ink lands horizontally flipped (`x → width − x` at capture): move
  right, the line goes left. Everyone including the drawer sees the same mirrored result;
  only the drawer's hand-eye loop is scrambled. Guessers/AI see a normal drawing.
- **Memory** — after **10s of drawing time**, the drawer's canvas fades to blank and stays
  blank ("finish from memory"); input keeps recording; guessers and the AI see everything
  live. Undo remains enabled (you just can't see what you undid).
- **Jitter** — a low-frequency drifting offset (a few px at canvas scale) added to captured
  points, producing wavering off-hand-looking lines. Everyone sees the wobble; the AI copes
  with it too — an equal-handicap round.

## Simultaneous mode (`simul`)

Round flow replaces the normal drawer/guesser split:

1. **Draw (45s):** every human draws the same prompt **privately** — no stroke relay, no
   chat/guessing. The AI roster row shows "watching…". Each client's own AI instance (the
   model is loaded on every client) watches its own canvas locally.
2. **Submit:** at the deadline each client sends `simul-submit(strokes, aiTopGuess,
   aiConfidence)` — vector strokes, tiny payloads.
3. **Gallery vote (20s):** server broadcasts all submissions; clients render replay-drawn
   gallery canvases. Humans vote for the best drawing that isn't their own
   (`simul-vote(playerId)`). The AI votes for the canvas it recognized as the prompt with
   the highest confidence, with a feed one-liner naming its pick.
4. **Reveal:** votes and points shown, then auto-advance as usual.

**Scoring:** 60 pts per human vote received; +40 bonus to the AI's pick; the AI itself earns
+25 per canvas whose top-1 guess matched the prompt (machine-legible drawings feed the
machine — humans-vs-AI stays live). AI-vote ties go to the earlier submission.

**Protocol additions:** phase variant or `RoundMeta` flag for the vote window
(`simul-gallery` with submissions + `votesAtMs`), `simul-submit`, `simul-vote`, and a
gallery payload type `{ playerId, name, strokes, aiTopGuess, aiConfidence }`. Exact shapes
finalized in the implementation plan.

**Trust note:** AI verdicts come from each drawer's own client — same trust model as Phase
3's drawer-hosted AI. Fine for friends; already covered by the Phase 10 hardening note.

## Error handling

- A player leaving mid-simul: their submission is dropped; votes for them are discarded; if
  fewer than 2 submissions arrive, the round ends as a no-contest (no points, normal reveal).
- Late joiners during simul wait in spectator state until the next round (they see the
  gallery/reveal).
- `set-chaos` from non-host or mid-match is ignored server-side (same pattern as
  `start-match`).
- Missing/never-arriving `simul-submit` (crashed tab): server closes submissions at deadline
  + 2s grace with whatever arrived.

## Verification (per modifier, before showing the user)

Headless Playwright, two browsers, as in Phase 3:

- **Mirror:** drawer draws a left-edge stroke; assert relayed normalized coords arrive
  right-edge-flipped and drawer/guesser canvases match pixel-wise.
- **Memory:** at t≈10s drawer's canvas is blank (pixel sample) while the guesser's still
  shows ink; drawing continues to relay.
- **Jitter:** a programmatic straight-line drag produces stored points with measurable
  lateral deviation; guesser sees the same wobbled stroke.
- **Simul:** full round with two browsers — private draw (no relay), submissions, gallery
  render, human vote + AI vote land, scores match the formula, auto-advance.
- `/play`: one chaos round smoke per canvas modifier.
- Existing no-chaos flow re-verified once at the end (regression).
