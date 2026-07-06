# PROGRESS — Drawing Arena (Humans vs AI)

> **Read this file first at the start of every session.** It is the single source of truth
> for project state across sessions. The full spec lives in `drawing_arena_master_prompt.md`.

## Project Overview

A real-time multiplayer drawing-and-guessing game (skribbl.io-style) where a live AI opponent
watches the canvas and guesses alongside human players, with a humans-vs-AI scoreboard. Later
phases add chaos modifiers, vector-stroke replays, in-browser AI commentary (WebLLM), a ranked
daily mode, and a phone-as-brush cross-device mode. No paid APIs anywhere: the guesser is a
custom CNN trained on Quick Draw running client-side, commentary runs in-browser over WebGPU.

## Tech Stack & Key Decisions (with rationale)

| Decision | Choice | Why |
| --- | --- | --- |
| Frontend | React 19 + TypeScript + Vite | Lots of non-canvas UI (lobby/chat/scoreboard); canvas is managed imperatively outside React's render cycle so drawing perf is unaffected |
| Backend | Node + TypeScript + Express 5 (+ Socket.io in Phase 3) | Per brief; TS shared with client catches socket-protocol bugs |
| Browser inference | **ONNX Runtime Web** (deviation from brief's TF.js, user-approved) | PyTorch → ONNX → browser in one step; the ONNX→TF.js conversion chain is unmaintained/brittle. Same zero-cost fully-client-side properties |
| Model | CNN on Quick Draw, ~100 curated categories | Visually distinct, fun-to-draw prompts; strong per-class accuracy; category list doubles as the game prompt list with difficulty tiers |
| Training | PyTorch on user's RTX 4060 (native Windows, Python 3.11) | User trains it themselves per brief; 8GB VRAM is ample for a 28×28 CNN |
| Persistence | SQLite (Phase 7) | Per brief; clear upgrade path to Postgres |
| Linter/format | oxlint (Vite template default) + Prettier config at root | Modern template default; consistent formatting across packages |
| Design direction | Bold editorial/brutalist base + hand-drawn ink accents | User asked for "most impressive"; reads as a designed product, drawing theme surfaces in details. Tokens in `client/src/index.css`: paper `#F5F2EA`, ink `#141414`, acid `#E8FF3C`, humans `#FF4D1C`, AI `#2547F4`; Archivo (display, expanded) / Caveat (hand notes) / Space Mono (numbers) |

## Phase Checklist

- [x] **Phase 0 — Setup & alignment** (repo, git, scaffolding, this file)
- [x] **Phase 1 — Train & validate the AI guesser** (87.6% top-1 / 96.6% top-5 val; browser-verified)
- [x] **Phase 2 — Single-player core loop** (2026-07-04 pacing rework awaits re-playtest)
- [x] **Phase 3 — Multiplayer** (rooms, Socket.io, AI as participant — browser-verified 2-player)
- [x] **Phase 4 — Chaos modifiers** (mirror, memory, jitter, simultaneous mode — e2e-verified, awaits playtest)
- [x] **Phase 5 — Replay system** (round-end + match-recap replays — e2e-verified, awaits playtest)
- [x] **Phase 6 — AI commentary** (**descoped 2026-07-06, user-approved**: templated data-driven
  roast/recap lines instead of WebLLM — built + e2e-verified, awaits playtest)
- [ ] ~~Phase 7 — Ranked daily mode~~ (**cut 2026-07-06, user-approved** — game complete without it)
- [ ] ~~Phase 8 — Cross-device mode~~ (**cut 2026-07-06, user-approved** — was a stretch goal)
- [x] **Phase 9 — Polish pass** (lite scope delivered 2026-07-06: mobile, motion, a11y; no sound)
- [ ] Phase 10 — Hardening & deploy (**target: Render free tier**, one web service serving
  server + built client; deferred hardening items stay deferred — friends-scale game)

## Current State — what works right now

- `client/` — Vite + React + TS app. Landing `/`; `/play` single-player; `/rooms` +
  `/rooms/:code` multiplayer; `/model-test` guesser lab. Run: `cd client && npm run dev`
  (Vite proxies `/socket.io` to :3001, so start the server too for multiplayer)
- `server/` — Express 5 + Socket.io game server: rooms with 4-letter codes, server-
  authoritative rounds/judging/scoring, AI as a room participant. Run: `cd server && npm run dev`
- `shared/protocol.ts` — the typed socket contract both packages import (single source of
  truth for wire types; both tsconfigs include `../shared`)
- `training/` — full pipeline: `download_data.py` (HTTP-Range partial downloads, ~2 GB total),
  `train.py` (CNN in `model.py`, AMP, `--smoke` flag), `export_onnx.py` (exports + verifies +
  installs into `client/public/model/`). All 100 category names validated against the official
  list; download URLs HEAD-checked.
- **Trained model shipped**: 12 epochs on the user's RTX 4060 (torch 2.12.1+cu126, ~3.5
  min/epoch), val top-1 87.6% / top-5 96.6%. Exported to `client/public/model/quickdraw.onnx`
  (1.8 MB single file, `external_data=False` — ORT-web can't fetch sibling .data files) with
  PyTorch parity 5.7e-06. Browser-verified: headless Chromium drew apple/sun/house/smiley
  face/clock on `/model-test`; all five guessed top-1 at ~100% confidence, zero console errors.
- `training/venv/` has CUDA torch; `training/data/` has all 100 categories (~2 GB).
- Playwright + Chromium installed (`client` devDep) for browser-driving verification — reuse it
  in later phases.
- `client/e2e/` — committed e2e suite (harness + 9 scripts, run `node client/e2e/<name>.e2e.mjs`
  from repo root); vitest unit tests in both packages (`npm test` in `client/` and `server/`).
- Chaos modifiers live in every room (host sets off/some/all in the lobby) and on `/play`
  ("chaos rounds" toggle).
- Replays are live in both modes: `/play` round-end panel + match recap, and rooms' round-end
  panel + `.room-recap` match-end grid. Animated auto-looping playback of the actual vector
  strokes for every round that had ink; empty rounds show no card/replay.
- THE MACHINE talks: a deadpan quip on every round-end panel and a 2-4 line "POST-MATCH
  ANALYSIS" roast at match end, both modes — templated from real match facts (wrong guesses,
  solve times, modifiers), no LLM (`client/src/lib/commentary.ts`).

## Next Immediate Step

**Final-day plan (2026-07-06):** ✅ Phase 6-lite commentary → ✅ Phase 9-lite polish →
③ Phase 10: README + Render free-tier deploy. **One combined user playtest** covers all
pending verdicts (Phase 2 AI pacing, Phase 4 chaos, Phase 5 replays, Phase 6 commentary):
`cd server && npm run dev` + `cd client && npm run dev`.

## Phase 2 notes (what was built)

- `/play`: 5-round match, difficulty ramps easy→hard (`lib/prompts.ts` — MATCH_TIERS,
  TIER_POINTS). Speed scoring: `tierBase * (0.25 + 0.75 * timeLeftFraction)`, rounded to 5s.
- `lib/aiPlayer.ts`: the AI as a believable player — 3.5s before its first guess, ≥1.6s + jitter
  between guesses, never repeats itself, confidence threshold decays 0.45→0.12 over the round
  (wilder shots as time runs out). It never sees the prompt; the game judges correctness.
- Round flow: reducer state machine (intro → drawing → round-end → match-end); give-up button;
  round-end panel lingers 900ms so the winning guess lands visibly.
- Browser-verified end-to-end: drew "sun", AI called it at ~4s, +95 pts awarded, give-up path
  and match summary all exercised, no real console errors (one benign ORT wasm-streaming
  fallback warning in dev).
- **2026-07-04 tuning pass (playtest feedback: "guesses way too quickly").** Root cause: the
  prompts come from the same 100 classes the model trained on, and Quick Draw training data is
  itself hasty doodles, so softmax confidence saturates within a few strokes — raw confidence
  is a weak brake. `aiPlayer.ts` reworked to be human-believable instead of just slower:
  (1) ink gate — no reaction until enough drawing exists (≥8 points, ≥40px, pen travel ≥1.6×
  drawing size); (2) conviction — same top pick must hold for 4 consecutive reads early round,
  relaxing to 2 late; (3) near-miss blurts — when #2 is within 0.35 of #1, 45% chance it calls
  the runner-up first (max 2/round). First-guess floor 3.5s→4.5s, start threshold 0.45→0.55.
  Verified: speed-drawn sun → first guess 4.8s (was ~4s), then it committed and stayed quiet
  rather than spamming runner-ups.
- **Canvas undo (user request):** `DrawingCanvas` takes an `undoToken` prop (mirrors
  `clearToken`) that pops the last stroke and redraws; `/play` has an "↩ Undo" button next to
  Give up, plus Ctrl+Z/Cmd+Z while drawing. Strokes stay vectors (Phase 5 replay unaffected);
  the AI observes the post-undo stroke list. Pixel-verified in the browser (button + Ctrl+Z).

## Phase 3 notes (what was built)

- `shared/protocol.ts` — typed Socket.io contract: `room-state` snapshots (broadcast on every
  transition; trivially correct for late joiners), stroke events with normalized 0..1 coords
  and `(strokeId, seq)` so batching/out-of-order/undo assemble correctly (the brief's
  lightweight OT-ish approach), masked-word round meta, shared feed entries.
- Server (`server/src/room.ts`, `prompts.ts`, `index.ts`): RoomManager + Room behind one
  interface (Redis pub/sub could slot in later per brief); 4-letter codes (no lookalikes);
  server-authoritative everything — secret word (sent only to the drawer, **after** the state
  broadcast: the client resets round-local state on seeing a new round, so word-first was a
  race, found in verification), guess judging (normalized compare + levenshtein "close!"
  nudges), speed scoring + 30% drawer cut, drawer rotation (everyone draws `max(2, ceil(4/n))`
  cycles), round ends on all-guessed/timeout/drawer-left, auto-advance after a 5s reveal.
  Prompts come from the model manifest (server reads `client/public/model/manifest.json`).
- Client: `/rooms` join/create screen (name remembered), lobby with copyable invite link,
  arena with drawer canvas (undo + Ctrl+Z, strokes streamed ~20Hz with immediate flush on
  stroke end) or guesser `LiveCanvas` (renders relayed vectors), `ChatFeed` (human + AI
  guesses in one stream, correct guesses celebrated with the word withheld), scoreboard,
  humans-vs-AI team strip, round/match-end panels.
- **AI participant**: the drawer's client hosts the AI's eyes — the unchanged Phase 2
  `AiPlayer` watches the drawer's local strokes and emits `ai-guess` over the socket; the
  server judges it like any player (it never sees the word) and scores it on team AI. It's in
  every room's player list as THE MACHINE.
- Verified end-to-end with two headless browsers: create/join, AI in lobby, mask never leaks
  the word, strokes + undo relay to the guesser canvas at matching positions, AI guess
  ("sun?") landed in both feeds, close-guess nudge, correct human guess scored 95 + 30 drawer
  cut, round-end reveal, drawer rotation to player B. Zero console errors.

## Phase 4 notes (what was built)

- Spec + plan: `docs/superpowers/specs/2026-07-04-chaos-modifiers-design.md`,
  `docs/superpowers/plans/2026-07-04-chaos-modifiers.md` (9 tasks, all done).
- **Modifier system**: the server rolls a modifier per round (`server/src/chaos.ts`,
  `rollModifier` — pure + unit-tested) and stamps it into `RoundMeta.modifier`; the host picks
  the chaos level in the lobby (`off`/`some`/`all`, `'set-chaos'` event). Rules: round 1 always
  clean, never the same modifier twice in a row, `some` = 40% odds (`CHAOS_SOME_CHANCE`),
  `simul` needs ≥2 humans. Banner + badge UI in `client/src/components/Chaos.tsx`.
- **Mirror & jitter** are capture-time point transforms (`client/src/lib/chaos.ts`,
  `transformFor` → `DrawingCanvas`'s `transformPoint` prop): the flip/wobble happens before a
  point is recorded, so relay, the AI's view, and Phase 5 replays just see the real drawing.
  Jitter = two incommensurate sines per axis keyed on the point timestamp (deterministic in t,
  unit-tested; amp ~1.2% of canvas).
- **Memory draw** is display-only: `DrawingCanvas`'s `hideInk` prop paints nothing while still
  recording; the drawer's canvas goes dark `MEMORY_HIDE_AFTER_MS` (10s) after their first ink;
  guessers see everything throughout.
- **Simultaneous mode** is a distinct round flow: everyone gets the word, draws privately
  (`SIMUL_DRAW_MS` 45s), each client auto-submits at the deadline with its own AI verdict
  (top guess + confidence via `'simul-submit'`), then a gallery vote (`SIMUL_VOTE_MS` 20s,
  can't vote for yourself). Scoring (`scoreSimul`, unit-tested): 60/vote received, +40 to the
  AI's pick (most-confident correct canvas, tie → earlier submission), AI team +25 per canvas
  it recognized. Late joiners spectate the in-flight round; the server sanitizes submitted
  strokes (clamped coords, volume caps).
- **/play chaos**: "chaos rounds" toggle on the intro screen (persisted in localStorage) rolls
  the three canvas modifiers with the same odds/no-repeat rules (`rollCanvasModifier`).
- **Test hooks**: server env `CHAOS_FORCE=<modifier>` forces every round, `SIMUL_DRAW_MS=<ms>`
  shortens the simul draw window, `/play?chaos=<modifier>` forces single-player rounds.
- **Tests**: vitest in both packages (`npm test`); committed e2e suite `client/e2e/` —
  `harness.mjs` (spawns server + vite on :5199, Playwright helpers) + 7 scripts (`basic`,
  `chaos-level`, `mirror`, `memory`, `jitter`, `play-chaos`, `simul`), each run with
  `node client/e2e/<name>.e2e.mjs` from repo root. All green 2026-07-05 along with both
  typechecks and lint.

## Phase 5 notes (what was built)

- Spec + plan: `docs/superpowers/specs/2026-07-05-replay-system-design.md`,
  `docs/superpowers/plans/2026-07-05-replay-system.md` (5 tasks, all done).
- **Timeline compression** (`client/src/lib/replay.ts`, `buildReplayTimeline`, pure + unit-
  tested): raw stroke timestamps capture how a round was really drawn — including long thinking
  pauses — so a replay first compresses the dead air, then rescales to a fixed clip. Pass 1
  walks strokes in order, keeping each stroke's internal point-to-point rhythm but capping the
  inter-stroke gap at `REPLAY_GAP_CAP_MS` (400ms); pass 2 linearly scales the whole compressed
  timeline so its last point lands exactly on `REPLAY_DURATION_MS` (4000ms). A defensive pass
  clamps any out-of-order timestamps (the wire sanitizer preserves order but doesn't prove it).
  `REPLAY_LOOP_PAUSE_MS` (700ms) is the hold after a finished drawing before the loop restarts —
  not part of the compressed timeline itself, just the player's idle gap.
- **`ReplayCanvas.tsx`**: takes raw normalized strokes, builds the compressed timeline once per
  `strokes` change, then drives a `requestAnimationFrame` loop that redraws the visible prefix
  every frame (full redraw per frame — cheap at doodle point counts, same approach as
  `LiveCanvas`). The in-progress stroke's tip is linearly interpolated between its surrounding
  points so growth looks continuous regardless of frame rate. Elapsed time is
  `(now - startedAt) % (durationMs + REPLAY_LOOP_PAUSE_MS)` clamped to `durationMs`, so the
  finished drawing holds during the pause window before looping. Auto-loops forever; restarts
  cleanly whenever the `strokes` prop changes (round switch, recap remount).
- **Where replays appear**: `/play` round-end panel (that round's replay) and match recap card
  grid (one card per round that had ink — empty/given-up rounds get no card, not a blank
  canvas); rooms' round-end panel (drawer and guessers all see the same replay) and the
  match-end `.room-recap` grid, same empty-round rule.
- **Client-side archive** (`Room.tsx`, `archiveRef` — a `Map<roundIndex, ArchivedRound>`, no
  server involvement): populated on entering `round-end` for a not-yet-archived round index,
  cleared when `roundIndex === 0` (start of a new match, since round indices restart). Stroke
  source depends on role: the drawer holds original px-space strokes in `drawerStrokesRef` and
  normalizes them against the canvas's rendered size; everyone else reads the already-normalized
  vectors out of `StrokeStore.visibleStrokes()`. For `simul` rounds there's no single "the
  drawer" — the archive instead stores the gallery's vote winner (most votes, tie → earliest
  gallery entry), matching the scoring rule from Phase 4.
- **Test hook**: `server/src/room.ts` reads `ROUND_DURATION_MS` from the environment (falls back
  to the real constant), mirroring the existing `SIMUL_DRAW_MS` pattern, so e2e scripts can
  shorten normal drawing rounds instead of waiting out the full timer.
- **Tests**: two new e2e scripts, `replay-play` and `replay-room` (round-end replay renders and
  animates, no replay for empty rounds, recap shows a card per drawn round and animates) —
  `client/e2e/` is now 9 scripts total. One review fix along the way: recap caption typography
  regressed and was restored (`0e0b7d0`).

## Phase 6 notes (what was built)

- Spec + plan: `docs/superpowers/specs/2026-07-06-ai-commentary-design.md`,
  `docs/superpowers/plans/2026-07-06-ai-commentary.md` (4 tasks, all done, inline execution).
- **Engine** (`client/src/lib/commentary.ts`, pure + unit-tested, 12 tests): a tiered,
  condition-matched line bank (~18 starter lines — every fact shape covered; growing it is
  one line per joke). `roundQuip(facts, usedIds, seed)` picks from the most specific eligible
  tier, seeded (mulberry32), never repeats an id within a match (falls back to reuse only when
  every eligible line is spent). `matchRoast(matchFacts, seed)` = opener (keyed on
  winner/margin, or solo recognized-count) + up to 2 superlatives (most-confused round,
  fastest solve, unsolved list, chaos count) + closer — always 2-4 lines. Voice: deadpan
  machine superiority; error-report self-deprecation when the AI loses. Simul rounds get
  dedicated tier-3 quips (no single drawer, so drawing quips never apply).
- **Components** (`client/src/components/Commentary.tsx` + `.css`): `MachineQuip` /
  `MachineAnalysis`, system-log styling — Space Mono, `--ai` blue, `> ` prefix.
- **Facts collection is per-client presentation** — zero server/protocol changes. `/play`:
  `RoundResult` gained `aiWrongGuesses`/`modifier`/`quip` (quip chosen in `closeRound`);
  rooms: `factsRef` map built at round-end from feed-tracking refs (`aiWrongRef`,
  `firstCorrectRef` → outcome/solver), mirrors the Phase 5 archive pattern, cleared at
  `roundIndex === 0`.
- **Tests**: `replay-play`/`replay-room` e2e extended (quip at round end on both drawer and
  guesser screens, 2-4 analysis lines at match end). Regression 2026-07-06: 23 client + 22
  server unit tests, both typechecks, lint, `replay-play`/`replay-room`/`basic`/`simul` e2e —
  all green.

## Phase 9 notes (what was built)

- Spec + plan: `docs/superpowers/specs/2026-07-06-polish-pass-design.md`,
  `docs/superpowers/plans/2026-07-06-polish-pass.md` (4 tasks, inline execution).
- **A11y**: global `:focus-visible` ring (3px acid, one rule in `index.css`, local duplicates
  removed); `prefers-reduced-motion: reduce` disables all CSS animation/transition and
  `ReplayCanvas` skips its rAF loop to paint the finished drawing statically (browser-verified
  with Playwright's `reducedMotion: 'reduce'`); interactive `DrawingCanvas` got an aria-label.
- **Mobile (≤480px)**: both arenas wrap the prompt bar and step down word/mask/timer sizes;
  tighter page gutters and round-end panel padding; home + join-screen title `clamp()` floors
  lowered (both clipped at 390px — found in the screenshot sweep, now 0px horizontal overflow).
  Simul gallery already collapses to one column (grid math, no change needed).
- **Motion**: match summaries rise in like the round panels; recap cards fade up with a 60ms
  stagger (capped at 5); `/play` score value bumps on change (span keyed on the score).
- Verified: mobile screenshot sweep at 390×844 reviewed, reduced-motion + focus-ring browser
  checks, full regression (below).

## Open Questions / Unsure About

- AI guess cadence/threshold values (`aiPlayer.ts` knobs) are game-feel numbers — need the
  user's playtest verdict on the 2026-07-04 human-believable rework.
- Multiplayer hardening deferred (noted for Phase 10): no reconnect-with-identity (a refresh
  = a new player), round timer trusts client clocks for display only, no rate limiting,
  AI guesses come from the drawer's client (fine for friends, spoofable in theory).
- Deployment target: deliberately deferred until Phase 10 (per brief, ask user then).

## Deferred Ideas — user-approved, revisit later (~Phase 9 polish)

- **Expand model categories beyond the prompt list** (user asked 2026-07-04, agreed to defer):
  retrain on ~200+ Quick Draw classes while keeping the curated ~100 as game prompts. Richer,
  funnier wrong guesses/near-misses; model stays a drop-in swap (onnx + manifest). Needs:
  separate "model categories" from "prompt list" in `prompts.ts` (today prompts derive from
  the manifest), curate/tier any new prompt-worthy classes, ~3-5 GB more data, ~2 h retrain on
  the 4060. Expect top-1 to drop from 87.6% toward ~75-80% — acceptable if the AI's behavior
  layer keeps pacing believable. Full 345 not recommended (near-duplicate classes + junk
  prompts like "squiggle").

## Decisions Already Made — do NOT re-litigate

1. ONNX Runtime Web instead of TensorFlow.js (user approved the deviation).
2. React + TS + Vite frontend; canvas handled imperatively.
3. ~100 curated categories (not full 345, not a tiny starter set).
4. Training on native Windows (no WSL); user has Python 3.11, needs PyTorch+CUDA installed.
5. Art direction: editorial/brutalist + ink accents (user delegated: "most impressive").
6. First session scope: Phase 0 + start of Phase 1 (user approved).
7. No paid APIs anywhere in the project.

## Session Log

- **2026-07-02** — Phase 0 complete (repo, git, client/server scaffolds, design tokens).
  Phase 1 built and smoke-verified end-to-end (training pipeline, ONNX export, `/model-test`
  page with live browser-verified guessing).
- **2026-07-02 (later)** — Phase 1 completed: real training run (87.6%/96.6%), model exported
  and browser-validated 5/5. Fixes along the way: pip>=23 needed for the PyTorch index,
  `onnxscript` needed by torch 2.12's exporter, UTF-8 stdout on Windows, single-file ONNX
  export. Phase 2 started on the user's go-ahead.
- **2026-07-02 (later still)** — Phase 2 built and browser-verified: `/play` single-player loop
  (AI player module, 5-round matches, speed scoring, round/match panels). Stopped here per the
  one-phase rule; Phase 3 awaits the user's go.
- **2026-07-04** — Phase 2 tuning from first playtest: AI made human-believable (ink gate,
  conviction streak, near-miss blurts) after "guesses too quickly" feedback; canvas undo added
  (button + Ctrl+Z). Both browser-verified. Awaiting re-playtest verdict; Phase 3 still awaits
  the user's go.
- **2026-07-04 (later)** — Phase 3 on the user's go: multiplayer built and verified with two
  headless browsers (rooms, typed socket protocol in `shared/`, vector stroke sync with undo,
  guess chat with close-nudges, speed scoring + drawer cut, drawer rotation, AI as a room
  participant hosted on the drawer's client, humans-vs-AI team strip). One race found & fixed
  in verification: `your-prompt` must be sent after the round's `room-state` broadcast.
  Category-expansion idea recorded under Deferred Ideas. Phase 4 awaits the user's go.
- **2026-07-04 → 2026-07-05** — Phase 4 on the user's go: chaos modifiers built task-by-task
  (TDD + committed e2e per modifier): server roll logic + lobby chaos control, mirror, memory
  draw, jitter, `/play` chaos toggle, simultaneous mode (server + client). Final regression
  pass 2026-07-05: 7 e2e scripts, 28 unit tests, typechecks, lint — all green. Phase 4 awaits
  the user's playtest verdict; Phase 5 awaits the user's go.
- **2026-07-05** — Phase 5 built via subagent-driven development (5 tasks, TDD + e2e): timeline
  compression (`replay.ts`), `ReplayCanvas` (rAF auto-loop, interpolated tip), `/play`
  round-end + recap integration, room round-end + match-recap integration. One review fix along
  the way (recap caption typography regression, restored). Final regression pass: all 9 e2e
  scripts (including the two new `replay-play`/`replay-room` scripts) green, 11 client + 22
  server unit tests, both typechecks, lint — all clean. Phase 5 awaits the user's playtest
  verdict (both modes, including the match-end recap grid); Phase 6 (AI commentary via WebLLM)
  awaits the user's go.
- **2026-07-06** — Final-day descope agreed with the user: finish today. Phase 7 (ranked) and
  Phase 8 (cross-device) cut; Phase 6 descoped from WebLLM to templated commentary; Phase 9
  lite; deploy target Render free tier. Phase 6-lite built inline (spec → plan → 4 tasks):
  commentary engine + MachineQuip/MachineAnalysis components + both mode integrations.
  Regression all green. Remaining: Phase 9-lite polish, Phase 10 README + Render deploy, and
  the user's single combined playtest (Phases 2/4/5/6 verdicts).
- **2026-07-06 (later)** — Phase 9-lite polish built inline (spec → plan → 4 tasks): global
  focus ring, reduced-motion support (CSS + static ReplayCanvas), drawing-canvas label,
  ≤480px pass for both arenas + title clamp fixes (home/join titles clipped at 390px, caught
  by the screenshot sweep), match-end entrances + recap stagger + score bump. Full regression:
  45 unit tests, both typechecks, lint, all 9 e2e scripts green. Remaining: Phase 10.
