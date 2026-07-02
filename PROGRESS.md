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

- `client/` — Vite + React + TS app. Landing page with design identity at `/`.
  Run: `cd client && npm install && npm run dev`
- `server/` — Express 5 skeleton with `GET /health` only (game server arrives Phase 2/3).
  Run: `cd server && npm install && npm run dev`
- `training/` — see Phase 1 section of this file once built.

## Next Immediate Step

Finish Phase 1 session work: training pipeline (`training/`) + `/model-test` page, then the
**user** runs training on their 4060 (PyTorch install → smoke run → full run → export), then
validate the model in the browser test page together.

## Open Questions / Unsure About

- Exact Quick Draw rasterization parameters (stroke width when rendering 28×28) need empirical
  validation on the test page — browser preprocessing must match training data distribution.
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
  Phase 1 started: training pipeline + model-test page.
