# AI vs Humans Drawing Arena — Master Build Prompt

## Your Role

You are building a polished, portfolio-grade, real-time multiplayer drawing-and-guessing game with a live AI opponent, working across multiple sessions with me. Treat this as a real production project, not a prototype or demo. I want extremely high code quality, thoughtful architecture, and a genuinely refined final product — not something that just barely works.

Read this entire brief first. Then, before writing a single line of code, list every clarifying question, ambiguity, or decision point you need me to weigh in on. Wait for my answers before starting Phase 0.

## Working Rules (read carefully — these matter more than the feature list)

1. **Ask first.** Before touching code, ask me any clarifying questions about scope, tech choices, or ambiguous requirements below.
2. **Plan, then confirm.** Propose a phased build plan (you can adjust my suggested phases below) and wait for my explicit go-ahead before starting.
3. **One phase at a time.** Build exactly one phase, then stop. Show me what you built, how to run/test it, and what decisions you made along the way. Do not start the next phase until I say "go" or "next."
4. **Always leave things working.** End every session in a fully working, committed state — never mid-feature. If you're running low on context or budget mid-phase, stop at the nearest clean checkpoint, update the progress file, and clearly tell me where you left off and what's half-done.
5. **Persistent progress file — this is critical, since this project will span multiple sessions.** Maintain a single file called `PROGRESS.md` at the project root. Update it every time you complete meaningful work. It must always contain:
   - Project overview (one paragraph)
   - Full tech stack and key architectural decisions, with brief rationale for each
   - Phase checklist (done / in progress / not started)
   - Current state: exactly what works right now, and how to run/test it
   - Next immediate step
   - Open questions or things you're unsure about
   - Decisions I made along the way that should not be re-litigated in a future session
   - At the **start of every new session**, read `PROGRESS.md` FIRST, before doing anything else, so you can resume with full context even though you have no memory of earlier sessions.
6. **Code quality bar:** clean file structure, meaningful naming, comments where logic is non-obvious, no dead code, no leftover placeholder/fake data. This should look like something a senior engineer shipped, not a hackathon entry.
7. **Design bar:** the UI should feel intentional and distinctive, not a generic template. Take real care with typography, spacing, color, and motion. I'd rather it look opinionated than safe and generic.
8. **Git discipline:** commit at the end of every phase with a clear, descriptive message. Set up git in Phase 0 if it isn't already.

## The Vision

A real-time multiplayer drawing-and-guessing game (think skribbl.io / Pictionary) with a twist: an AI is also playing, live — watching the canvas and trying to guess alongside the humans. Humans vs AI, tracked on a running scoreboard. On top of that core loop, layer in chaos modifiers, a replay system, AI commentary, and a ranked daily mode. Full spec below.

## Full Feature Spec

### Core Gameplay Loop
- Players join a room via room code
- Each round, one player draws a secret prompt while everyone else — human players AND the AI — try to guess it
- Points awarded based on speed of correct guess (the drawer also scores when others guess correctly)
- Drawer role rotates each round
- Live guess chat, correct guesses revealed/celebrated in real time
- Round timer, prompt difficulty tiers

### The AI Opponent (must be open-source / self-hosted — no paid API required anywhere in this project)
- The AI watches canvas strokes live and submits guesses like a real player, with a realistic "thinking" delay — not instant
- Primary implementation: a CNN trained on Google's open Quick Draw dataset, exported to TensorFlow.js, running **entirely client-side in the browser** — no server round-trip, no inference cost
- I have an RTX 4060 (8GB VRAM) and want to train this model myself rather than use a pre-trained one. Write the training script (PyTorch), walk me through running it, and build the export pipeline (ONNX → TensorFlow.js)
- Stretch goal, later phase, optional: a self-hosted small vision-language model (via Ollama) for open-ended guessing beyond the fixed Quick Draw category list
- AI guesses appear in the same feed as human guesses — it should feel like a real player, not a gimmick

### Chaos Modifiers (random or selectable per round)
- Mirrored canvas (drawing appears flipped)
- Memory draw (canvas hides ~10 seconds in, drawer finishes blind)
- Non-dominant-hand mode (propose an implementation — could be an input handicap or just a fun constraint)
- Simultaneous mode: everyone draws the same prompt at once, room votes on the best one afterward

### Replay System
- Store strokes as vectors (points, timestamps, color, width) — never raw pixels or video
- After each round, auto-generate a smooth animated replay of how the drawing was built, playable inline
- This also keeps replays tiny to store and easy to share

### AI Post-Game Commentary
- After a match, generate a short, funny AI "roast" or recap of the drawings and performance
- Implement via WebLLM (in-browser LLM inference over WebGPU) running a small quantized model — no backend, no API key
- Should reference specifics of what actually happened in the match, not generic filler

### Ranked / Daily Mode
- Daily mode with a global leaderboard (Elo-style rating)
- Persist results — propose a lightweight persistence approach (SQLite is probably fine to start)

### Cross-Device Mode (stretch, later phase)
- "Phone as brush, TV/laptop as shared canvas" — Jackbox-style setup where drawing input comes from a phone and the shared display is the canvas

### Technical Requirements (design with these in mind even if not built until later)
- Real-time sync should feel sub-100ms; send vector stroke events over the wire, not full canvas snapshots
- Plan the sync architecture to tolerate out-of-order or conflicting stroke events (a lightweight CRDT/operational-transform-style approach — not full pixel diffing)
- Design the room/session layer so it could later scale via Redis pub/sub across multiple server instances (doesn't need to be built now — just don't architect yourself into a corner)
- Basic anti-cheat: detect and flag guesses submitted implausibly fast (instant-paste bot behavior)

## Suggested Tech Stack (propose alternatives if you have a strong reason to deviate)
- Backend: Node.js + Express + Socket.io
- Frontend: your call — vanilla JS/Canvas for max control, or React if it'll genuinely speed up UI work without hurting canvas performance. Tell me which and why.
- Persistence: SQLite to start (clear upgrade path to Postgres later if needed)
- AI: TensorFlow.js (client-side CNN) + WebLLM (client-side commentary) — no Claude/OpenAI API calls anywhere in this project
- Model training: PyTorch, run locally on my RTX 4060 (8GB VRAM)

## Suggested Phase Breakdown (adjust as you see fit, but confirm with me before changing it significantly)

**Phase 0 — Setup & Alignment**
Ask your clarifying questions. Confirm tech stack. Set up repo, git, project scaffolding, `PROGRESS.md`.

**Phase 1 — Train and validate the AI guesser (standalone, no game yet)**
Write and help me run the Quick Draw CNN training script on my 4060. Export to TensorFlow.js. Build a tiny standalone test page: I draw, the model guesses live. Get this feeling good before building anything else — this is the riskiest, most novel part of the project, so de-risk it first.

**Phase 2 — Single-player core loop**
One player, one browser tab: prompt shown, draw, AI guesses live, scoring works. No multiplayer yet. This proves the core game feel.

**Phase 3 — Multiplayer**
Rooms, Socket.io sync, multiple human players drawing/guessing together in real time. AI joins as a participant with its own guesses in the shared feed. Humans vs AI scoreboard.

**Phase 4 — Chaos modifiers**
Implement each modifier one at a time; show me each before moving to the next.

**Phase 5 — Replay system**
Vector stroke storage + animated replay playback.

**Phase 6 — AI commentary**
WebLLM integration for the post-match roast/recap.

**Phase 7 — Ranked daily mode**
Daily seed/prompt set, Elo rating, persistent leaderboard.

**Phase 8 — Cross-device mode**
Phone-as-brush / shared-screen-as-canvas.

**Phase 9 — Polish pass**
Visual design pass, animation/motion polish, sound, mobile responsiveness, accessibility check.

**Phase 10 — Hardening & deploy**
Anti-cheat pass, performance pass, deployment (ask me where I want to host it before doing this), final README.

This will likely span multiple sessions — that's expected and fine. Just make sure `PROGRESS.md` is always accurate so a fresh session can pick up exactly where the last one left off, with no lost context.

## Before You Start

Read everything above, then reply with:
1. Your list of clarifying questions
2. Your proposed (possibly adjusted) phase plan
3. Any concerns about scope or approach

Do not write any code until I've answered your questions and approved the plan.
