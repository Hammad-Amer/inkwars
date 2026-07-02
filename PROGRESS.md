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
- [x] **Phase 2 — Single-player core loop** (awaiting user playtest feedback)
- [ ] Phase 3 — Multiplayer (rooms, Socket.io, AI as participant)
- [ ] Phase 4 — Chaos modifiers
- [ ] Phase 5 — Replay system (vector strokes)
- [ ] Phase 6 — AI commentary (WebLLM)
- [ ] Phase 7 — Ranked daily mode (Elo, SQLite)
- [ ] Phase 8 — Cross-device mode (stretch)
- [ ] Phase 9 — Polish pass
- [ ] Phase 10 — Hardening & deploy

## Current State — what works right now

- `client/` — Vite + React + TS app. Landing page at `/`; `/model-test` page draws + runs the
  guesser (shows a "No model yet" state until export). Run: `cd client && npm run dev`
- `server/` — Express 5 skeleton with `GET /health` only (game server arrives Phase 2/3).
  Run: `cd server && npm run dev`
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

**User playtests Phase 2** (`cd client && npm run dev` → `/play`): does the AI's guessing
cadence feel like a player? Is 60s/5-rounds right? Tune the knobs at the top of
`client/src/lib/aiPlayer.ts` based on feedback. Then, on the user's "go": Phase 3
(multiplayer — rooms, Socket.io, AI as a participant in the shared guess feed).

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

## Open Questions / Unsure About

- AI guess cadence/threshold values (`aiPlayer.ts` knobs) are game-feel numbers — need the
  user's playtest verdict.
- Deployment target: deliberately deferred until Phase 10 (per brief, ask user then).

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
