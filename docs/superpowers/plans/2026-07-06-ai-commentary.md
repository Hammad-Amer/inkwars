# AI Commentary (Phase 6-lite) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give THE MACHINE a deadpan, data-driven voice: one quip on every round-end panel and a 2–4 line "POST-MATCH ANALYSIS" roast at match end, in both `/play` and rooms.

**Architecture:** A pure line-engine module (`commentary.ts`: condition-matched template bank, seeded selection, no repeats per match) + two tiny presentational components (`Commentary.tsx`). Facts are collected client-side from data each mode already has — zero server or protocol changes.

**Tech Stack:** React 19 + TS (client only), vitest for units, existing Playwright e2e harness.

**Spec:** `docs/superpowers/specs/2026-07-06-ai-commentary-design.md`

## Global Constraints

- No server changes, no `shared/protocol.ts` changes, no new dependencies.
- Voice: dry machine superiority; self-deprecating error-report humor when the AI loses. No exclamation marks.
- Quips never repeat a line id within one match; the pool falls back to reuse only if every eligible line is used.
- Roast is always 2–4 lines (opener + 0–2 superlatives + closer).
- Styling uses existing tokens from `client/src/index.css` (`--font-mono`, `--ai`, `--border`, `--paper-raised`, `--font-display`).
- All paths below are relative to the repo root `C:\Users\hamma\Desktop\PROJECT 1`.
- Commit after every task; run commands from the stated directory.

---

### Task 1: The line engine (`commentary.ts`)

**Files:**
- Create: `client/src/lib/commentary.ts`
- Test: `client/src/lib/commentary.test.ts`

**Interfaces:**
- Consumes: `ChaosModifier` from `shared/protocol.ts` (`'mirror' | 'memory' | 'jitter' | 'simul'`).
- Produces (Tasks 2–3 rely on these exact signatures):
  - `type RoundOutcome = 'ai' | 'human' | 'unsolved'`
  - `interface RoundFacts { prompt: string; outcome: RoundOutcome; solveMs: number | null; roundDurationMs: number; modifier: ChaosModifier | null; aiWrongGuesses: string[]; solverName?: string }`
  - `type MatchFacts = { mode: 'solo'; rounds: RoundFacts[]; totalPoints: number } | { mode: 'room'; rounds: RoundFacts[]; teamHumans: number; teamAi: number }`
  - `roundQuip(f: RoundFacts, usedIds: Set<string>, seed: number): { id: string; text: string }`
  - `matchRoast(m: MatchFacts, seed: number): string[]`

- [ ] **Step 1: Write the failing tests**

Create `client/src/lib/commentary.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { matchRoast, roundQuip, type MatchFacts, type RoundFacts } from './commentary'

const base: RoundFacts = {
  prompt: 'sun',
  outcome: 'ai',
  solveMs: 5000,
  roundDurationMs: 60_000,
  modifier: null,
  aiWrongGuesses: [],
}

const round = (over: Partial<RoundFacts>): RoundFacts => ({ ...base, ...over })

describe('roundQuip', () => {
  it('is deterministic for the same facts and seed', () => {
    expect(roundQuip(base, new Set(), 42)).toEqual(roundQuip(base, new Set(), 42))
  })

  it('prefers the most specific tier: unsolved with no guesses hits the blank-round line', () => {
    const q = roundQuip(round({ outcome: 'unsolved', solveMs: null }), new Set(), 1)
    expect(q.id).toBe('unsolved-blank')
    expect(q.text).toContain('sun')
  })

  it('skips used ids and falls back a tier', () => {
    const f = round({ outcome: 'unsolved', solveMs: null })
    const q = roundQuip(f, new Set(['unsolved-blank']), 1)
    expect(q.id).not.toBe('unsolved-blank')
  })

  it('still answers when every line has been used', () => {
    const used = new Set<string>()
    const f = round({ outcome: 'unsolved', solveMs: null })
    for (let i = 0; i < 40; i++) used.add(roundQuip(f, used, i).id)
    expect(roundQuip(f, used, 99).text.length).toBeGreaterThan(0)
  })

  it('simul rounds always get a simul quip', () => {
    const q = roundQuip(round({ modifier: 'simul' }), new Set(), 7)
    expect(q.id.startsWith('simul')).toBe(true)
  })

  it('fills wrong-guess slots', () => {
    const q = roundQuip(
      round({ outcome: 'unsolved', solveMs: null, aiWrongGuesses: ['broccoli', 'spider'] }),
      new Set(),
      3,
    )
    expect(q.id).toBe('unsolved-blame')
    expect(q.text).toContain('broccoli')
    expect(q.text).toContain('spider')
  })

  it('names the human who beat it', () => {
    const q = roundQuip(round({ outcome: 'human', solverName: 'ayesha' }), new Set(), 5)
    expect(q.text).toContain('ayesha')
  })
})

describe('matchRoast', () => {
  const soloMatch: MatchFacts = {
    mode: 'solo',
    totalPoints: 310,
    rounds: [
      base,
      round({ prompt: 'cat', outcome: 'unsolved', solveMs: null, aiWrongGuesses: ['broccoli', 'lion', 'dog', 'tiger'] }),
      round({ prompt: 'house', solveMs: 3000 }),
    ],
  }

  it('is deterministic and 2-4 lines', () => {
    const lines = matchRoast(soloMatch, 11)
    expect(lines).toEqual(matchRoast(soloMatch, 11))
    expect(lines.length).toBeGreaterThanOrEqual(2)
    expect(lines.length).toBeLessThanOrEqual(4)
  })

  it('mentions the total points in the solo opener', () => {
    expect(matchRoast(soloMatch, 11)[0]).toContain('310')
  })

  it('surfaces the most-confused round in a superlative line', () => {
    expect(matchRoast(soloMatch, 11).join(' ')).toContain('broccoli')
  })

  it('gloats when team AI wins a room match', () => {
    const m: MatchFacts = { mode: 'room', rounds: [base], teamHumans: 100, teamAi: 400 }
    expect(matchRoast(m, 2).join(' ')).toContain('inevitable')
  })

  it('logs a fault when the humans win', () => {
    const m: MatchFacts = { mode: 'room', rounds: [base], teamHumans: 400, teamAi: 100 }
    expect(matchRoast(m, 2).join(' ')).toContain('Fault logged')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `client/`: `npx vitest run src/lib/commentary.test.ts`
Expected: FAIL — cannot resolve `./commentary`.

- [ ] **Step 3: Implement the engine**

Create `client/src/lib/commentary.ts`:

```ts
import type { ChaosModifier } from '../../../shared/protocol'

/**
 * Phase 6-lite: THE MACHINE's voice. A pure, template-bank commentary engine —
 * no LLM, no network. Lines are condition-matched against real round/match
 * facts; the most specific eligible tier wins; selection is seeded and never
 * repeats a line id within a match (usedIds).
 */

export type RoundOutcome = 'ai' | 'human' | 'unsolved'

export interface RoundFacts {
  /** the revealed word */
  prompt: string
  /** who solved it first ('unsolved' = timeout or give-up) */
  outcome: RoundOutcome
  /** ms into the round of the first correct guess (null when unsolved) */
  solveMs: number | null
  roundDurationMs: number
  modifier: ChaosModifier | null
  /** THE MACHINE's wrong guesses that round, in order */
  aiWrongGuesses: string[]
  /** multiplayer: the human who got it first (when outcome === 'human') */
  solverName?: string
}

export type MatchFacts =
  | { mode: 'solo'; rounds: RoundFacts[]; totalPoints: number }
  | { mode: 'room'; rounds: RoundFacts[]; teamHumans: number; teamAi: number }

// --- seeded rng ---------------------------------------------------------------

/** mulberry32 — tiny deterministic PRNG so tests can pin selections */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const secs = (ms: number) => (ms / 1000).toFixed(1)

// --- round quips ----------------------------------------------------------------

interface QuipLine {
  id: string
  /** higher = more specific; the highest eligible tier always wins */
  tier: number
  when: (f: RoundFacts) => boolean
  render: (f: RoundFacts) => string
}

const ROUND_LINES: QuipLine[] = [
  // tier 3 — simul rounds have no single drawer; never fall through to drawing quips
  {
    id: 'simul-1',
    tier: 3,
    when: (f) => f.modifier === 'simul',
    render: (f) => `Simultaneous "${f.prompt}" analysis complete. Several canvases. One correct opinion: mine.`,
  },
  {
    id: 'simul-2',
    tier: 3,
    when: (f) => f.modifier === 'simul',
    render: () => 'Everyone drew at once. I evaluated all of it. I remain unimpressed at scale.',
  },
  // tier 2 — specific
  {
    id: 'ai-fast',
    tier: 2,
    when: (f) => f.outcome === 'ai' && f.solveMs !== null && f.solveMs < 6000,
    render: (f) => `"${f.prompt}" identified in ${secs(f.solveMs!)}s. Statistically, you have drawn this before.`,
  },
  {
    id: 'ai-buzzer',
    tier: 2,
    when: (f) => f.outcome === 'ai' && f.solveMs !== null && f.solveMs > f.roundDurationMs * 0.7,
    render: (f) => `"${f.prompt}" confirmed at the last possible moment. You made this difficult. Logged.`,
  },
  {
    id: 'ai-journey',
    tier: 2,
    when: (f) => f.outcome === 'ai' && f.aiWrongGuesses.length >= 3,
    render: (f) =>
      `Eventually: "${f.prompt}". My ${f.aiWrongGuesses.length} prior hypotheses included "${f.aiWrongGuesses[0]}". I stand by the journey.`,
  },
  {
    id: 'unsolved-blame',
    tier: 2,
    when: (f) => f.outcome === 'unsolved' && f.aiWrongGuesses.length >= 2,
    render: (f) =>
      `I offered "${f.aiWrongGuesses[0]}". I offered "${f.aiWrongGuesses[1]}". You were drawing "${f.prompt}". One of us is malfunctioning.`,
  },
  {
    id: 'unsolved-blank',
    tier: 2,
    when: (f) => f.outcome === 'unsolved' && f.aiWrongGuesses.length === 0,
    render: (f) => `Zero viable hypotheses generated. The word was "${f.prompt}". This has been filed as your fault.`,
  },
  {
    id: 'human-first',
    tier: 2,
    when: (f) => f.outcome === 'human' && !!f.solverName,
    render: (f) => `${f.solverName} reached "${f.prompt}" before I did. Anomaly logged. Recalibrating.`,
  },
  {
    id: 'mirror',
    tier: 2,
    when: (f) => f.modifier === 'mirror',
    render: () => 'Mirror round. You struggled with left and right. I do not experience either. Advantage: machine.',
  },
  {
    id: 'memory',
    tier: 2,
    when: (f) => f.modifier === 'memory',
    render: (f) => `You finished "${f.prompt}" from memory. It showed.`,
  },
  {
    id: 'jitter',
    tier: 2,
    when: (f) => f.modifier === 'jitter',
    render: (f) => `Seismic interference detected. Your "${f.prompt}" survived. Barely.`,
  },
  // tier 1 — outcome-generic
  {
    id: 'ai-solved-1',
    tier: 1,
    when: (f) => f.outcome === 'ai',
    render: (f) => `"${f.prompt}" identified in ${secs(f.solveMs ?? 0)}s. Adequate.`,
  },
  {
    id: 'ai-solved-2',
    tier: 1,
    when: (f) => f.outcome === 'ai',
    render: (f) => `Recognition complete: "${f.prompt}". You may continue.`,
  },
  {
    id: 'human-solved-1',
    tier: 1,
    when: (f) => f.outcome === 'human',
    render: (f) => `A human arrived at "${f.prompt}" first. Reviewing my priorities. Review complete: still superior.`,
  },
  {
    id: 'unsolved-1',
    tier: 1,
    when: (f) => f.outcome === 'unsolved',
    render: (f) => `Round terminated. "${f.prompt}" remains unverified. Disappointing for exactly one of us.`,
  },
  // tier 0 — always eligible, so the pool can never be empty
  { id: 'generic-1', tier: 0, when: () => true, render: () => 'Processing round. Conclusion: it happened.' },
  { id: 'generic-2', tier: 0, when: () => true, render: () => 'Data archived. Judgment reserved. Mostly.' },
]

export function roundQuip(f: RoundFacts, usedIds: Set<string>, seed: number): { id: string; text: string } {
  const eligible = ROUND_LINES.filter((l) => l.when(f))
  const fresh = eligible.filter((l) => !usedIds.has(l.id))
  const source = fresh.length > 0 ? fresh : eligible // all used → allow reuse
  const top = Math.max(...source.map((l) => l.tier))
  const pool = source.filter((l) => l.tier === top)
  const line = pool[Math.floor(mulberry32(seed)() * pool.length)]
  return { id: line.id, text: line.render(f) }
}

// --- match roast -----------------------------------------------------------------

const pick = (rand: () => number, variants: string[]) => variants[Math.floor(rand() * variants.length)]

function opener(m: MatchFacts, rand: () => number): string {
  if (m.mode === 'solo') {
    const n = m.rounds.length
    const k = m.rounds.filter((r) => r.outcome === 'ai').length
    if (k === n)
      return `Analysis complete: ${k} of ${n} drawings recognized. ${m.totalPoints} points. Your hands are legible. That is the highest compliment I issue.`
    if (k === 0)
      return `I recognized nothing. ${m.totalPoints} points. I would suggest lessons, but optimism is inefficient.`
    return pick(rand, [
      `${k} of ${n} drawings identified. ${m.totalPoints} points. A performance occurred.`,
      `Match parsed: ${k} of ${n} recognized, ${m.totalPoints} points. I have seen worse. Not often.`,
    ])
  }
  if (m.teamAi > m.teamHumans)
    return `Final score: machine ${m.teamAi}, humans ${m.teamHumans}. The outcome was never in doubt. It rarely is.`
  if (m.teamHumans > m.teamAi)
    return `Final score: humans ${m.teamHumans}, machine ${m.teamAi}. Enjoy it. Anomalies rarely repeat.`
  return `A tie at ${m.teamHumans}. Statistically the least satisfying outcome. Well done, I suppose.`
}

/** 0-2 lines about the match's most quotable facts, most interesting first */
function superlatives(m: MatchFacts): string[] {
  const out: string[] = []
  const confused = [...m.rounds]
    .filter((r) => r.aiWrongGuesses.length >= 2)
    .sort((a, b) => b.aiWrongGuesses.length - a.aiWrongGuesses.length)[0]
  if (confused)
    out.push(
      `"${confused.prompt}" required ${confused.aiWrongGuesses.length} failed hypotheses, including "${confused.aiWrongGuesses[0]}". I choose to blame the artist.`,
    )
  const solved = m.rounds.filter((r) => r.solveMs !== null)
  if (solved.length > 0) {
    const fastest = solved.reduce((a, b) => (a.solveMs! <= b.solveMs! ? a : b))
    out.push(`Fastest recognition: "${fastest.prompt}" in ${secs(fastest.solveMs!)}s. That drawing almost respected my time.`)
  }
  const missed = m.rounds.filter((r) => r.outcome === 'unsolved' && r.modifier !== 'simul')
  if (missed.length > 0)
    out.push(`Unrecognized: ${missed.map((r) => `"${r.prompt}"`).join(', ')}. Filed under "abstract expressionism".`)
  const chaos = m.rounds.filter((r) => r.modifier !== null).length
  if (chaos >= 2) out.push(`${chaos} chaos rounds survived. The wobble was intentional. Mine, not yours.`)
  return out.slice(0, 2)
}

function closer(m: MatchFacts, rand: () => number): string {
  if (m.mode === 'solo')
    return pick(rand, [
      'Match archived. Return when your hands improve.',
      'Session closed. I will be here. I am always here.',
    ])
  if (m.teamAi > m.teamHumans) return 'Conclusion: the machine wins. This message was inevitable.'
  if (m.teamHumans > m.teamAi) return 'Fault logged. Recalibration scheduled. Enjoy this while it lasts.'
  return 'We settle this next match. Bring the same humans. I will bring more machine.'
}

export function matchRoast(m: MatchFacts, seed: number): string[] {
  const rand = mulberry32(seed)
  return [opener(m, rand), ...superlatives(m), closer(m, rand)]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run from `client/`: `npx vitest run src/lib/commentary.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Typecheck + lint, then commit**

Run from `client/`: `npx tsc -b` then `npx oxlint`
Expected: no errors.

```bash
git add client/src/lib/commentary.ts client/src/lib/commentary.test.ts
git commit -m "Phase 6 task 1: commentary line engine (roundQuip + matchRoast)"
```

---

### Task 2: Presentational components + `/play` integration

**Files:**
- Create: `client/src/components/Commentary.tsx`, `client/src/components/Commentary.css`
- Modify: `client/src/pages/Play.tsx`
- Test (e2e): `client/e2e/replay-play.e2e.mjs`

**Interfaces:**
- Consumes: `roundQuip`, `matchRoast`, `RoundFacts` from Task 1 (exact signatures in Task 1's Produces block).
- Produces (Task 3 relies on): `MachineQuip({ text }: { text: string })` and `MachineAnalysis({ lines }: { lines: string[] })` — both render nothing-adjacent markup with classes `.machine-quip` / `.machine-analysis` (e2e selectors).

- [ ] **Step 1: Create the components**

`client/src/components/Commentary.tsx`:

```tsx
import './Commentary.css'

/** one deadpan system-log line from THE MACHINE (round-end panels) */
export function MachineQuip({ text }: { text: string }) {
  return (
    <p className="machine-quip">
      <span aria-hidden="true">&gt; </span>
      {text}
    </p>
  )
}

/** the post-match roast block (match-end screens) */
export function MachineAnalysis({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null
  return (
    <section className="machine-analysis" aria-label="post-match analysis from the AI">
      <h2 className="machine-analysis-title">Post-match analysis</h2>
      <ul>
        {lines.map((line, i) => (
          <li key={i}>
            <span aria-hidden="true">&gt; </span>
            {line}
          </li>
        ))}
      </ul>
    </section>
  )
}
```

`client/src/components/Commentary.css`:

```css
/* THE MACHINE's voice: system-log styling on team-AI blue */
.machine-quip,
.machine-analysis li {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  line-height: 1.5;
  color: var(--ai);
  text-align: left;
}

.machine-quip {
  margin: 0.9rem auto 0;
  max-width: 46ch;
}

.machine-analysis {
  margin: 2rem auto;
  max-width: 62ch;
  padding: 1rem 1.25rem;
  border: var(--border);
  border-color: var(--ai);
  background: var(--paper-raised);
  text-align: left;
}

.machine-analysis-title {
  margin: 0 0 0.6rem;
  font-family: var(--font-display);
  font-size: 0.8rem;
  font-stretch: expanded;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ai);
}

.machine-analysis ul {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 0.45rem;
}
```

- [ ] **Step 2: Collect facts and quips in `Play.tsx`**

All edits to `client/src/pages/Play.tsx`:

(a) Add imports (after the existing `ReplayCanvas` import):

```tsx
import { MachineAnalysis, MachineQuip } from '../components/Commentary'
import { matchRoast, roundQuip, type RoundFacts } from '../lib/commentary'
```

Also add `useMemo` to the existing `react` import.

(b) Extend `RoundResult` (currently `Play.tsx:19-26`):

```tsx
interface RoundResult {
  prompt: Prompt
  points: number
  /** null = time ran out */
  guessedAtMs: number | null
  /** normalized final drawing, for the replay */
  strokes: NormPoint[][]
  /** the AI's wrong guesses that round, for commentary */
  aiWrongGuesses: string[]
  modifier: CanvasChaosModifier | null
  /** THE MACHINE's round-end quip, chosen when the round closes */
  quip: string
}
```

(c) Add a module-level converter (near `scoreFor`, `Play.tsx:76`):

```tsx
function factsFor(r: Omit<RoundResult, 'quip'>): RoundFacts {
  return {
    prompt: r.prompt.name,
    outcome: r.guessedAtMs === null ? 'unsolved' : 'ai',
    solveMs: r.guessedAtMs,
    roundDurationMs: ROUND_DURATION_MS,
    modifier: r.modifier,
    aiWrongGuesses: r.aiWrongGuesses,
  }
}
```

(d) Add two refs next to `feedIdRef` (`Play.tsx:108`):

```tsx
const aiWrongRef = useRef<string[]>([])
const usedQuipIdsRef = useRef(new Set<string>())
```

(e) In `closeRound` (`Play.tsx:132-149`), replace the `result` construction with:

```tsx
const base: Omit<RoundResult, 'quip'> = {
  prompt,
  guessedAtMs,
  points: guessedAtMs === null ? 0 : scoreFor(prompt, guessedAtMs),
  strokes: size ? normalizeStrokes(latestStrokesRef.current, size) : [],
  aiWrongGuesses: [...aiWrongRef.current],
  modifier: modifierRef.current,
}
const quip = roundQuip(factsFor(base), usedQuipIdsRef.current, (Math.random() * 2 ** 31) | 0)
usedQuipIdsRef.current.add(quip.id)
const result: RoundResult = { ...base, quip: quip.text }
```

(f) In `startRound` (right after `latestStrokesRef.current = []`, `Play.tsx:174`): add `aiWrongRef.current = []`.

(g) In the `AiPlayer` `onGuess` callback (`Play.tsx:180-188`), after `const correct = ...`: add `if (!correct) aiWrongRef.current.push(category)`.

(h) In `startMatch` (`Play.tsx:234`), before `dispatch`: add `usedQuipIdsRef.current.clear()`.

- [ ] **Step 3: Render the quip and the roast**

(a) In `RoundEndPanel` (`Play.tsx:375-395`), after the `play-panel-points` line, before the button:

```tsx
<MachineQuip text={result.quip} />
```

(b) In `MatchSummary` (`Play.tsx:397`), compute the roast at the top of the component:

```tsx
const [seed] = useState(() => (Math.random() * 2 ** 31) | 0)
const analysis = useMemo(
  () => matchRoast({ mode: 'solo', rounds: results.map(factsFor), totalPoints: total }, seed),
  [results, total, seed],
)
```

(add `useState` — already imported — and render `<MachineAnalysis lines={analysis} />` between `.play-summary-sub` and the `.play-recap` list).

- [ ] **Step 4: Extend the e2e script**

In `client/e2e/replay-play.e2e.mjs`, after the two round-end panel assertions (line 25):

```js
const quip = await page.locator('.play-panel .machine-quip').textContent()
assert(quip !== null && quip.length > 10, 'round-end panel shows a MACHINE quip')
```

And after the recap assertions (line 46):

```js
const analysisLines = await page.locator('.play-summary .machine-analysis li').count()
assert(analysisLines >= 2 && analysisLines <= 4, 'summary shows a 2-4 line post-match analysis')
```

- [ ] **Step 5: Run the e2e, typecheck, lint**

From the repo root: `node client/e2e/replay-play.e2e.mjs`
Expected: `replay-play e2e: PASS` including the two new assertions.

From `client/`: `npx tsc -b` then `npx oxlint` — no errors.
From `client/`: `npx vitest run` — all client unit tests still pass.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/Commentary.tsx client/src/components/Commentary.css client/src/pages/Play.tsx client/e2e/replay-play.e2e.mjs
git commit -m "Phase 6 task 2: MACHINE quips + post-match analysis on /play"
```

---

### Task 3: Room integration

**Files:**
- Modify: `client/src/pages/Room.tsx`
- Test (e2e): `client/e2e/replay-room.e2e.mjs`

**Interfaces:**
- Consumes: `roundQuip`, `matchRoast`, `RoundFacts` (Task 1); `MachineQuip`, `MachineAnalysis` (Task 2).
- Produces: nothing downstream.

- [ ] **Step 1: Collect per-round facts in `Room.tsx`**

(a) Imports (after the `ReplayCanvas` import):

```tsx
import { MachineAnalysis, MachineQuip } from '../components/Commentary'
import { matchRoast, roundQuip, type RoundFacts } from '../lib/commentary'
```

Also add `useMemo` to the `react` import.

(b) New state + refs (next to `archiveRef`, `Room.tsx:80`):

```tsx
const [quip, setQuip] = useState<string | null>(null)
const aiWrongRef = useRef<string[]>([])
const firstCorrectRef = useRef<{ isAi: boolean; name: string; atMs: number } | null>(null)
const factsRef = useRef(new Map<number, RoundFacts>())
const usedQuipIdsRef = useRef(new Set<string>())
```

(c) In `onFeed` (`Room.tsx:152-155`), before the existing `gotIt` line:

```tsx
if (entry.kind === 'guess' && entry.isAi) aiWrongRef.current.push(entry.text)
if (entry.kind === 'correct' && firstCorrectRef.current === null)
  firstCorrectRef.current = { isAi: entry.isAi, name: entry.name, atMs: entry.atMs }
```

(d) In the new-round housekeeping block of `onRoomState` (`Room.tsx:90-107`), alongside `drawerStrokesRef.current = []`:

```tsx
aiWrongRef.current = []
firstCorrectRef.current = null
setQuip(null)
```

and extend the new-match line (`Room.tsx:106`) to also clear commentary state:

```tsx
if (state.phase.round.roundIndex === 0) {
  archiveRef.current.clear() // new match
  factsRef.current.clear()
  usedQuipIdsRef.current.clear()
}
```

(e) In `onRoomState`, add a facts/quip branch right before the existing archive branch (`Room.tsx:112`):

```tsx
if (state.phase.name === 'round-end' && !factsRef.current.has(state.phase.round.roundIndex)) {
  const { round, reveal } = state.phase
  const first = firstCorrectRef.current
  const facts: RoundFacts = {
    prompt: reveal.word,
    outcome:
      round.modifier === 'simul' || first === null ? 'unsolved' : first.isAi ? 'ai' : 'human',
    solveMs: round.modifier === 'simul' ? null : (first?.atMs ?? null),
    roundDurationMs: ROUND_DURATION_MS,
    modifier: round.modifier,
    aiWrongGuesses: [...aiWrongRef.current],
    solverName: first && !first.isAi ? first.name : undefined,
  }
  factsRef.current.set(round.roundIndex, facts)
  const q = roundQuip(facts, usedQuipIdsRef.current, (Math.random() * 2 ** 31) | 0)
  usedQuipIdsRef.current.add(q.id)
  setQuip(q.text)
}
```

- [ ] **Step 2: Render quip + roast**

(a) Pass the quip into the round-end panel (`Room.tsx:449-457`): add prop `quip={quip}`; in `RoundEndPanel`'s signature add `quip: string | null`, and render after the gains list / `nobody scored` block, before the `aiPickId` note:

```tsx
{quip && <MachineQuip text={quip} />}
```

(b) Pass facts into `MatchEnd` (`Room.tsx:461-468`): add prop

```tsx
facts={[...factsRef.current.entries()].sort((a, b) => a[0] - b[0]).map(([, f]) => f)}
```

In `MatchEnd` add `facts: RoundFacts[]` to its props and compute at the top:

```tsx
const [seed] = useState(() => (Math.random() * 2 ** 31) | 0)
const analysis = useMemo(
  () =>
    facts.length === 0
      ? []
      : matchRoast({ mode: 'room', rounds: facts, teamHumans: room.teamHumans, teamAi: room.teamAi }, seed),
  [facts, room.teamHumans, room.teamAi, seed],
)
```

Render `<MachineAnalysis lines={analysis} />` right after the `.room-summary-teams` paragraph, before the recap grid.

- [ ] **Step 3: Extend the e2e script**

In `client/e2e/replay-room.e2e.mjs`, after the round-panel replay assertions (line 23):

```js
for (const [page, who] of [[a, 'drawer'], [b, 'guesser']]) {
  const quip = await page.locator('.room-panel .machine-quip').textContent()
  assert(quip !== null && quip.length > 10, `${who} sees a MACHINE quip at round end`)
}
```

After the recap assertions (line 27):

```js
const analysisLines = await a.locator('.room-summary .machine-analysis li').count()
assert(analysisLines >= 2 && analysisLines <= 4, 'match end shows a 2-4 line post-match analysis')
```

- [ ] **Step 4: Run the e2e, typecheck, lint**

From the repo root: `node client/e2e/replay-room.e2e.mjs`
Expected: `replay-room e2e: PASS` including the three new assertions.

From `client/`: `npx tsc -b` then `npx oxlint` — no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/Room.tsx client/e2e/replay-room.e2e.mjs
git commit -m "Phase 6 task 3: MACHINE quips + post-match analysis in rooms"
```

---

### Task 4: Regression pass + PROGRESS.md

**Files:**
- Modify: `PROGRESS.md`

- [ ] **Step 1: Full unit + typecheck + lint sweep**

- From `client/`: `npx vitest run` — expect all suites green (commentary + replay + chaos).
- From `server/`: `npm test` — expect 22 tests green (untouched, but prove it).
- From `client/`: `npx tsc -b`; from `server/`: `npm run typecheck` — no errors.
- From `client/`: `npx oxlint` — no errors.

- [ ] **Step 2: e2e sweep of the affected flows**

From the repo root, expect PASS from each:

```bash
node client/e2e/replay-play.e2e.mjs
node client/e2e/replay-room.e2e.mjs
node client/e2e/basic.e2e.mjs
node client/e2e/simul.e2e.mjs
```

(`basic` and `simul` guard the Room.tsx round/feed plumbing the integration touched.)

- [ ] **Step 3: Update PROGRESS.md**

- Check the Phase 6 checklist box.
- Add a "Phase 6 notes (what was built)" section: engine (`commentary.ts`, tiered bank, seeded, no-repeat), components, both integrations, e2e coverage.
- Update "Current State" and "Next Immediate Step" (next: Phase 9-lite polish).
- Add a session-log entry dated 2026-07-06.

- [ ] **Step 4: Commit**

```bash
git add PROGRESS.md
git commit -m "Phase 6 complete: templated AI commentary (quips + post-match analysis)"
```
