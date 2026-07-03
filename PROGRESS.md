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
- [ ] Phase 4 — Chaos modifiers
- [ ] Phase 5 — Replay system (vector strokes)
- [ ] Phase 6 — AI commentary (WebLLM)
- [ ] Phase 7 — Ranked daily mode (Elo, SQLite)
- [ ] Phase 8 — Cross-device mode (stretch)
- [ ] Phase 9 — Polish pass
- [ ] Phase 10 — Hardening & deploy

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

## Next Immediate Step

**User playtests Phase 3** (start both: `cd server && npm run dev` and `cd client && npm run
dev`, then open `/rooms` in two browser windows — or share the invite link on the LAN). Also
still pending: the re-playtest verdict on the 2026-07-04 AI pacing rework (`/play` or any
multiplayer round where you draw). Then, on the user's "go": Phase 4 (chaos modifiers, one at
a time, showing each before the next).

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
