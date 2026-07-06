# Hardening & Deploy (Phase 10) — Design

**Date:** 2026-07-06 · **Status:** approved by user (Render free tier chosen; deep hardening
items stay deferred — friends-scale game).

## Shape

One Render **free-tier web service** runs the Express + Socket.io server and serves the built
client — a single origin, so the client's same-origin `io()` and `/socket.io` path work
unchanged. Deploy from the existing GitHub repo (`Hammad-Amer/inkwars`) via a committed
`render.yaml` Blueprint. The user does the Render dashboard steps; everything else is code.

## Changes

1. **Static client serving** (`server/src/index.ts`): when `client/dist/index.html` exists
   (i.e. production), `express.static(clientDist)` + an SPA fallback that sends `index.html`
   for GET requests (excluding `/socket.io`). `CLIENT_DIST` env overrides the default
   `path.resolve('client/dist')` (cwd-relative — Render runs from the repo root).
2. **Manifest path fix**: `prompts.ts` resolves the manifest relative to the *compiled* file
   (`server/dist/...`), which breaks in production. No code change — `render.yaml` sets
   `MODEL_MANIFEST_PATH=client/dist/model/manifest.json` (Vite copies `public/` into `dist/`;
   `readFileSync` resolves relative paths against cwd = repo root).
3. **`render.yaml`** (repo root): one `web` service, `runtime: node`, `plan: free`,
   `healthCheckPath: /health`, build = `npm ci --include=dev` in both packages + both builds
   (`--include=dev` because Render sets NODE_ENV=production, which would skip the TS/Vite
   toolchain), start = `node server/dist/server/src/index.js`, env vars from #2.
4. **README rewrite**: what the game is (all shipped features), stack, quick start, training
   pipeline pointer, testing (unit + e2e), deploy instructions, live URL placeholder the user
   fills after first deploy.
5. **PROGRESS.md**: Phase 10 completion + final session log.

## Verification

- **Local prod simulation before pushing**: build both packages, run the compiled server with
  `MODEL_MANIFEST_PATH` set, drive it with Playwright against `http://localhost:3001` directly
  (no Vite): home renders, `/health` ok, create room + start match works.
- Push to GitHub; user applies the Blueprint on Render; verify the live URL end-to-end.

## User's steps (the only manual part)

1. Playtest verdicts (Phases 2/4/5/6) — independent of deploy.
2. After the push: at https://dashboard.render.com — sign in with GitHub → **New + →
   Blueprint** → select `Hammad-Amer/inkwars` → Apply (free plan, no card needed).
3. Paste the service URL back; the free tier sleeps after ~15 min idle (first hit takes ~30-60s).

## Out of scope (deferred hardening, recorded in PROGRESS.md)

Reconnect-with-identity, rate limiting, server-side AI verification, Postgres upgrade path.
