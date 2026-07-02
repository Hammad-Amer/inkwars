# Drawing Arena — Humans vs AI

A real-time multiplayer drawing-and-guessing game with a twist: an AI opponent watches the
canvas live and guesses alongside the humans. Built with React, Node, and a custom CNN trained
on [Google Quick Draw](https://quickdraw.withgoogle.com/data) running entirely in the browser
via ONNX Runtime Web — no paid APIs anywhere.

**Status: early development.** See [`PROGRESS.md`](./PROGRESS.md) for current state and the
phase plan, and [`drawing_arena_master_prompt.md`](./drawing_arena_master_prompt.md) for the
full spec.

## Layout

| Directory | What |
| --- | --- |
| `client/` | React + TypeScript + Vite frontend |
| `server/` | Node + TypeScript game server (Express, Socket.io in later phases) |
| `training/` | PyTorch training pipeline for the Quick Draw guesser (see `training/README.md`) |

## Quick start

```bash
cd client && npm install && npm run dev   # frontend on http://localhost:5173
cd server && npm install && npm run dev   # server on http://localhost:3001
```
