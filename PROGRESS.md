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
- [ ] **Phase 1 — Train & validate the AI guesser** ← IN PROGRESS (pipeline built; training run pending on user's GPU)
- [ ] Phase 2 — Single-player core loop
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
- **Verified end-to-end** on 2026-07-02 with a CPU smoke model (2 categories, 1 epoch):
  download → train → ONNX export (matches PyTorch to 2.6e-08) → headless-Chromium draw test on
  `/model-test` returned live guesses with zero console errors. Smoke artifacts were deleted
  afterwards (placeholders don't get committed); the user's real training regenerates them.
- `training/venv/` exists with CPU-only torch (from verification). `training/data/` already has
  apple + banana.
- Playwright + Chromium installed (`client` devDep) for browser-driving verification — reuse it
  in later phases.

## Next Immediate Step

**User action:** install CUDA torch and train for real — follow `training/README.md`
(install cu126 torch into the existing venv → `train.py --smoke` to confirm GPU → download all
categories → full `train.py` → `export_onnx.py`). Then validate guess quality together on
`/model-test` and tune preprocessing if needed. After that: commit the exported model, mark
Phase 1 done, and start Phase 2 (single-player core loop).

## Open Questions / Unsure About

- Browser rasterization was matched empirically to the dataset (centered, ~25/28 max-dim,
  ~1.3px strokes — verified against real apple.npy statistics), but real-model guess quality on
  human drawings still needs eyeballing once training completes; stroke width / margins may
  need a tweak.
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
  page with live browser-verified guessing). Remaining for Phase 1: the user's real GPU
  training run + guess-quality validation.
