/**
 * The socket protocol shared by client and server — the single source of
 * truth for everything that crosses the wire in multiplayer. Imported by
 * both packages (client via Vite/bundler resolution, server via NodeNext),
 * so keep it dependency-free and erasable-syntax-only (types, interfaces,
 * plain consts).
 *
 * Sync design (per the brief's technical requirements):
 * - Vector stroke events only, never pixels. Coordinates are normalized to
 *   0..1 of the (square) canvas so differently-sized canvases stay
 *   proportional — this feeds the Phase 5 replay format too.
 * - Every stroke event carries (strokeId, seq) so receivers tolerate
 *   batched, duplicated, or out-of-order delivery: points are placed by
 *   sequence slot, undo targets a stroke id regardless of arrival order.
 * - The server broadcasts full `room-state` snapshots on every transition
 *   (small: players + phase, no strokes) rather than deltas — trivially
 *   correct for late joiners and reconnects. Strokes flow separately, with
 *   a replayable snapshot for mid-round joiners.
 */

export type Tier = 'easy' | 'medium' | 'hard'

export const TIER_POINTS: Record<Tier, number> = { easy: 100, medium: 150, hard: 200 }

/** The AI participant's fixed player id — present in every room. */
export const AI_PLAYER_ID = 'ai'
export const AI_PLAYER_NAME = 'THE MACHINE'

export const ROUND_DURATION_MS = 60_000
/** round-end reveal panel duration before the next round auto-starts */
export const ROUND_END_LINGER_MS = 5_000

// --- players & room state ---------------------------------------------------

export interface RoomPlayer {
  id: string
  name: string
  isAi: boolean
  isHost: boolean
  score: number
}

export interface RoundMeta {
  roundIndex: number
  totalRounds: number
  drawerId: string
  tier: Tier
  /** the secret word with letters masked ("___ ____") for the blanks display */
  mask: string
  /** server epoch ms when the round ends */
  endsAtMs: number
}

export interface RoundReveal {
  word: string
  reason: 'all-guessed' | 'timeout' | 'drawer-left'
  /** points gained this round, by player id (absent = 0) */
  gains: Record<string, number>
}

export type RoomPhase =
  | { name: 'lobby' }
  | { name: 'drawing'; round: RoundMeta }
  | { name: 'round-end'; round: RoundMeta; reveal: RoundReveal; nextAtMs: number }
  | { name: 'match-end' }

export interface RoomState {
  code: string
  players: RoomPlayer[]
  phase: RoomPhase
  /** running humans-vs-AI team totals (sum of member scores) */
  teamHumans: number
  teamAi: number
}

// --- strokes over the wire ---------------------------------------------------

/** x/y normalized to 0..1 of the square canvas; t = ms since drawing start */
export interface NormPoint {
  x: number
  y: number
  t: number
}

export type StrokeEvent =
  | { type: 'begin'; strokeId: number; point: NormPoint }
  | { type: 'points'; strokeId: number; seq: number; points: NormPoint[] }
  | { type: 'undo'; strokeId: number }

// --- guess/chat feed ----------------------------------------------------------

export type FeedKind =
  | 'guess' // a wrong guess — shown as chat
  | 'correct' // correct guess — word withheld, celebrated
  | 'system' // joins, leaves, round events

export interface FeedEntry {
  id: number
  /** empty for system entries */
  playerId: string
  name: string
  isAi: boolean
  kind: FeedKind
  /** empty for 'correct' entries (the word stays secret until reveal) */
  text: string
  /** ms since round start (0 outside rounds) */
  atMs: number
}

// --- socket event maps ---------------------------------------------------------

export type JoinResult =
  | { ok: true; playerId: string; state: RoomState }
  | { ok: false; error: string }

export interface ServerToClientEvents {
  'room-state': (state: RoomState) => void
  /** sent only to the drawer at round start */
  'your-prompt': (word: string) => void
  'stroke-event': (ev: StrokeEvent) => void
  /** current round's strokes so far — sent to mid-round joiners */
  'canvas-snapshot': (events: StrokeEvent[]) => void
  feed: (entry: FeedEntry) => void
  /** private nudge when a guess is one edit away */
  'close-guess': (text: string) => void
}

export interface ClientToServerEvents {
  'create-room': (name: string, ack: (res: JoinResult) => void) => void
  'join-room': (code: string, name: string, ack: (res: JoinResult) => void) => void
  /** host only, from lobby or match-end */
  'start-match': () => void
  /** drawer only, during 'drawing' */
  'stroke-event': (ev: StrokeEvent) => void
  /** non-drawers, during 'drawing' */
  guess: (text: string) => void
  /** the AI's guess, submitted by the drawer's client (which hosts its eyes) */
  'ai-guess': (category: string, confidence: number) => void
}
