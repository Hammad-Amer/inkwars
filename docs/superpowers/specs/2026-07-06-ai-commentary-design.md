# AI Commentary (Phase 6-lite) — Design

**Date:** 2026-07-06 · **Status:** approved by user (descope from WebLLM approved same day)

## What & why

THE MACHINE gets a voice: deadpan, clinical, system-log commentary built from real match
data. Replaces the original WebLLM plan (user-approved descope: no 1–2 GB download, no
WebGPU requirement, controllable humor). Two surfaces, both modes:

- **Round-end quip** — one line on the round-end panel (`/play` and rooms).
- **Match-end roast** — a "POST-MATCH ANALYSIS" block of 2–4 lines on the `/play` summary
  and the room `.room-recap`.

Voice: dry machine superiority ("Analysis: that was allegedly a cat."); flips to
error-report self-deprecation when team AI loses ("Fault logged. Recalibrating.").

## Architecture

Pure presentation, per-client. **No server changes, no protocol changes, no new deps.**

### `client/src/lib/commentary.ts` (new, pure, no React)

```ts
interface RoundFacts {
  prompt: string                 // revealed word
  outcome: 'ai' | 'human' | 'unsolved'   // who solved it (unsolved = timeout/give-up)
  solveMs: number | null
  roundDurationMs: number
  modifier: ChaosModifier | null
  aiWrongGuesses: string[]       // in order, that round
  solverName?: string            // multiplayer: the human who got it
}
interface MatchFacts {
  rounds: RoundFacts[]
  teamHumans: number
  teamAi: number
  mode: 'solo' | 'room'
}
roundQuip(facts: RoundFacts, usedIds: Set<string>, seed: number): { id: string; text: string }
matchRoast(facts: MatchFacts, seed: number): string[]   // 2–4 lines
```

- **Line bank:** ~40–60 entries `{ id, when(facts), tier, render(facts) }`. Tier =
  specificity (e.g. "AI guessed it in <5s" beats generic "AI solved it"). Selection:
  filter eligible → keep highest tier present → seeded-pick (mulberry32-style LCG is fine)
  → never reuse an id within a match (`usedIds`).
- **Slots** filled from facts: the word, wrong guesses ("I said *broccoli*. Twice."),
  solve seconds, modifier names, solver name.
- **Roast structure:** opener keyed on who won + margin, 1–2 superlative lines (fastest
  solve, most-confused round = most wrong guesses, chaos casualties, unsolved words),
  closer keyed on win/loss. Dedup against each other by id.

### Facts collection

- **`/play`:** extend `RoundResult` with `aiGuesses: string[]` and `modifier` captured at
  `end-round` (the feed already holds AI guess entries; snapshot the round's wrong ones).
  Give-up/timeout both map to `outcome: 'unsolved'`.
- **Rooms:** a `factsRef: Map<roundIndex, RoundFacts>` in `Room.tsx`, populated on
  entering `round-end` (mirrors Phase 5's `archiveRef` pattern, cleared the same way at
  `roundIndex === 0`). Wrong guesses = that round's `FeedEntry`s with `isAi && kind ===
  'guess'`; outcome/solver from `RoundReveal` + gains. `simul` rounds map to the same
  `RoundFacts` shape with `outcome: 'unsolved'` semantics ignored: they get a small set
  of dedicated generic simul quips (keyed on `modifier === 'simul'`), no per-canvas
  analysis — keeps the line bank focused.

### UI

- Quip: system-log styling — Space Mono, AI-blue (`#2547F4`) accent, `> ` prefix — on the
  existing round-end panels. No layout rework.
- Roast: titled "POST-MATCH ANALYSIS", same styling, one line per row, on both match-end
  surfaces.

### Testing

- Unit (vitest, `commentary.test.ts`): eligibility filtering, tier preference, seed
  determinism, no id repeats within a match, roast line count 2–4, slot rendering.
- e2e: extend `replay-play` and `replay-room` to assert a quip node exists at round-end
  and the analysis block at match-end.

## Out of scope

WebLLM, mid-round taunts, server-side anything, sound.
