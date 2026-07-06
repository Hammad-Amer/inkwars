# Drawing Arena — Humans vs AI

A real-time multiplayer drawing-and-guessing game (skribbl.io-style) with a twist: **a live
AI opponent watches the canvas and guesses alongside the humans.** The guesser is a custom
CNN trained on [Google Quick Draw](https://quickdraw.withgoogle.com/data) that runs entirely
in the browser via ONNX Runtime Web — no paid APIs anywhere, nothing leaves your machine.

**▶ Play it live: https://inkwars.onrender.com** *(free tier — first visit after an idle
spell takes ~30–60 s to wake)*

## What's in the game

- **Solo practice (`/play`)** — five rounds, you draw a secret word, THE MACHINE calls out
  guesses in real time; the faster it recognizes your drawing, the more you score.
- **Multiplayer rooms (`/rooms`)** — 4-letter room codes, server-authoritative rounds and
  scoring, guess chat with "close!" nudges, drawer rotation, and a humans-vs-AI team score.
  The AI sits in every room as a player.
- **Chaos modifiers** — mirror drawing, memory draw (lights out mid-round), shaky hands, and
  a simultaneous mode where everyone draws at once and the gallery votes.
- **Replays** — every round ends with an animated vector replay of the drawing, plus a
  match-end recap grid.
- **AI commentary** — THE MACHINE narrates round ends and delivers a deadpan post-match
  analysis built from real match data (its wrong guesses, solve times, chaos casualties).
- **The model** — ~100 curated Quick Draw categories, 87.6% top-1 / 96.6% top-5 validation
  accuracy, 1.8 MB ONNX file, guessing at canvas framerate in-browser.

## Stack

| Piece | Choice |
| --- | --- |
| Frontend | React 19 + TypeScript + Vite (canvas managed imperatively) |
| Server | Node + TypeScript, Express 5 + Socket.io (server-authoritative game logic) |
| Shared contract | `shared/protocol.ts` — one typed socket protocol imported by both sides |
| AI guesser | PyTorch-trained CNN → ONNX → ONNX Runtime Web (WASM) in the browser |
| Commentary | Template engine over match facts (`client/src/lib/commentary.ts`) — no LLM |

## Quick start (dev)

```bash
cd server && npm install && npm run dev   # game server on :3001
cd client && npm install && npm run dev   # app on :5173 (proxies /socket.io to :3001)
```

Open http://localhost:5173. The trained model ships in `client/public/model/`, so this works
out of the box.

## Production build / self-host

One Node service serves both the API/socket and the built client:

```bash
npm run build --prefix client
npm run build --prefix server
MODEL_MANIFEST_PATH=client/dist/model/manifest.json node server/dist/server/src/index.js
```

Environment: `PORT` (default 3001), `MODEL_MANIFEST_PATH` (required in prod — the built
client's copy), `CLIENT_DIST` (optional override of `client/dist`).

## Deploy on Render (free tier)

The repo ships a `render.yaml` Blueprint:

1. Push to GitHub.
2. [dashboard.render.com](https://dashboard.render.com) → **New + → Blueprint** → select this
   repo → **Apply**. That's it — build command, start command, health check, and env vars all
   come from `render.yaml`.
3. Free-tier note: the service sleeps after ~15 minutes idle; the first request after that
   takes ~30–60 s.

## Train your own model

`training/` has the full pipeline (Python 3.11 + PyTorch, CUDA optional):

```bash
cd training
python download_data.py     # ~2 GB of Quick Draw bitmaps (100 categories)
python train.py             # ~45 min on an RTX 4060 (12 epochs)
python export_onnx.py       # exports + verifies + installs into client/public/model/
```

See `training/README.md` for details. The category list doubles as the game's prompt list.

## Tests

```bash
cd client && npm test       # unit (vitest): replay timeline, chaos, commentary engine
cd server && npm test       # unit (vitest): chaos rolls, simul scoring
node client/e2e/basic.e2e.mjs   # e2e (Playwright) — 9 scripts in client/e2e/
```

Each e2e script spins up the real server + Vite and drives headless Chromium through actual
matches (drawing included).

## Layout

| Directory | What |
| --- | --- |
| `client/` | React app: pages, canvas components, AI player, guesser, commentary, e2e suite |
| `server/` | Game server: rooms, rounds, judging, scoring, chaos rolls |
| `shared/` | The typed socket protocol both packages import |
| `training/` | PyTorch training pipeline for the Quick Draw guesser |
| `docs/superpowers/` | Per-phase specs and implementation plans |

`PROGRESS.md` is the cross-session project log: every phase, decision, and verification.
