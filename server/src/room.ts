import type { Server, Socket } from 'socket.io'
import {
  AI_PLAYER_ID,
  AI_PLAYER_NAME,
  ROUND_DURATION_MS,
  ROUND_END_LINGER_MS,
  type ChaosLevel,
  type ChaosModifier,
  type ClientToServerEvents,
  type FeedEntry,
  type RoomPhase,
  type RoomPlayer,
  type RoomState,
  type RoundMeta,
  type RoundReveal,
  type ServerToClientEvents,
  type StrokeEvent,
} from '../../shared/protocol.js'
// @ts-expect-error ENABLED_MODIFIERS used in Task 4
import { ENABLED_MODIFIERS, isChaosModifier, rollModifier } from './chaos.js'
import { drawerCut, guessPoints, pickMatchPrompts, type Prompt } from './prompts.js'

export type IoServer = Server<ClientToServerEvents, ServerToClientEvents>
export type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents>

/**
 * One game room: membership, lobby, and the server-authoritative round loop.
 * The server owns the secret word, judges every guess (human and AI), scores,
 * and rotates the drawer; clients only ever see what they're entitled to.
 *
 * All room access goes through RoomManager so the storage/broadcast layer
 * could later move behind Redis pub/sub without touching game logic.
 */

interface Human {
  socketId: string
  name: string
  score: number
}

interface ActiveRound {
  index: number
  totalRounds: number
  prompts: Prompt[]
  drawerId: string
  word: string
  startedAt: number // epoch ms
  endsAt: number
  strokes: StrokeEvent[]
  correct: Set<string> // player ids (humans + AI) who got it
  gains: Map<string, number>
  /** guards stale timers after a round ends early */
  token: number
  modifier: ChaosModifier | null
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no lookalikes
const MAX_GUESS_LENGTH = 40

function normalizeGuess(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, ' ')
}

/** Edit distance, for "you're close!" nudges. */
function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i)
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0]
    dp[0] = j
    for (let i = 1; i <= a.length; i++) {
      const tmp = dp[i]
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[a.length]
}

export class Room {
  readonly code: string
  private readonly io: IoServer
  private readonly onEmpty: () => void

  private humans: Human[] = [] // join order; drawer rotation follows it
  private hostId: string | null = null
  private aiScore = 0
  private chaosLevel: ChaosLevel = 'off'
  private lastModifier: ChaosModifier | null = null
  private phase: RoomPhase = { name: 'lobby' }
  private round: ActiveRound | null = null
  private roundToken = 0
  private feedId = 0
  private pendingTimer: ReturnType<typeof setTimeout> | null = null

  constructor(code: string, io: IoServer, onEmpty: () => void) {
    this.code = code
    this.io = io
    this.onEmpty = onEmpty
  }

  // --- membership -------------------------------------------------------------

  join(socket: IoSocket, name: string): RoomState {
    const trimmed = name.trim().slice(0, 20) || 'anon'
    this.humans.push({ socketId: socket.id, name: trimmed, score: 0 })
    this.hostId ??= socket.id
    socket.join(this.code)
    this.system(`${trimmed} joined`)
    // mid-round joiners need the drawing so far
    if (this.round && this.phase.name === 'drawing') {
      socket.emit('canvas-snapshot', this.round.strokes)
    }
    this.broadcast()
    return this.state()
  }

  leave(socketId: string): void {
    const human = this.humans.find((h) => h.socketId === socketId)
    if (!human) return
    this.humans = this.humans.filter((h) => h.socketId !== socketId)
    this.system(`${human.name} left`)

    if (this.humans.length === 0) {
      this.clearTimer()
      this.onEmpty()
      return
    }
    if (this.hostId === socketId) this.hostId = this.humans[0].socketId

    if (this.round && this.phase.name === 'drawing' && this.round.drawerId === socketId) {
      this.endRound('drawer-left')
    } else if (this.round && this.phase.name === 'drawing') {
      // the departed guesser may have been the last one holding the round open
      this.maybeFinishRound()
    }
    this.broadcast()
  }

  // --- match flow ---------------------------------------------------------------

  startMatch(socketId: string): void {
    if (socketId !== this.hostId) return
    if (this.phase.name !== 'lobby' && this.phase.name !== 'match-end') return
    if (this.humans.length === 0) return

    for (const h of this.humans) h.score = 0
    this.aiScore = 0
    // everyone draws the same number of times; short matches padded to ≥4 rounds
    const cycles = Math.max(2, Math.ceil(4 / this.humans.length))
    const totalRounds = cycles * this.humans.length
    const prompts = pickMatchPrompts(totalRounds)
    this.startRound(0, totalRounds, prompts)
  }

  setChaos(socketId: string, level: ChaosLevel): void {
    if (socketId !== this.hostId || this.phase.name !== 'lobby') return
    if (level !== 'off' && level !== 'some' && level !== 'all') return
    this.chaosLevel = level
    this.broadcast()
  }

  private startRound(index: number, totalRounds: number, prompts: Prompt[]): void {
    const drawer = this.humans[index % this.humans.length]
    const prompt = prompts[index]
    const now = Date.now()
    const forced = process.env.CHAOS_FORCE
    const modifier = isChaosModifier(forced)
      ? forced
      : rollModifier({
          level: this.chaosLevel,
          roundIndex: index,
          humanCount: this.humans.length,
          last: this.lastModifier,
        })
    if (modifier) this.lastModifier = modifier
    this.round = {
      index,
      totalRounds,
      prompts,
      drawerId: drawer.socketId,
      word: prompt.name,
      startedAt: now,
      endsAt: now + ROUND_DURATION_MS,
      strokes: [],
      correct: new Set(),
      gains: new Map(),
      token: ++this.roundToken,
      modifier,
    }
    this.phase = { name: 'drawing', round: this.roundMeta() }
    this.system(`round ${index + 1} — ${drawer.name} is drawing`)
    if (modifier) this.system(`CHAOS: ${modifier}`)
    this.broadcast()
    // after the state broadcast: the client resets round-local state (incl.
    // its prompt) when it sees the new round, so the word must arrive second
    this.io.to(drawer.socketId).emit('your-prompt', prompt.name)

    const token = this.round.token
    this.setTimer(() => {
      if (this.round?.token === token && this.phase.name === 'drawing') this.endRound('timeout')
    }, ROUND_DURATION_MS)
  }

  private endRound(reason: RoundReveal['reason']): void {
    const round = this.round
    if (!round || this.phase.name !== 'drawing') return
    this.clearTimer()

    const reveal: RoundReveal = {
      word: round.word,
      reason,
      gains: Object.fromEntries(round.gains),
    }
    const isLast = round.index + 1 >= round.totalRounds
    this.phase = {
      name: 'round-end',
      round: this.roundMeta(),
      reveal,
      nextAtMs: Date.now() + ROUND_END_LINGER_MS,
    }
    this.broadcast()

    const token = round.token
    this.setTimer(() => {
      if (this.round?.token !== token) return
      if (isLast || this.humans.length === 0) {
        this.round = null
        this.phase = { name: 'match-end' }
        this.broadcast()
      } else {
        this.startRound(round.index + 1, round.totalRounds, round.prompts)
      }
    }, ROUND_END_LINGER_MS)
  }

  // --- strokes -------------------------------------------------------------------

  strokeEvent(socketId: string, ev: StrokeEvent): void {
    const round = this.round
    if (!round || this.phase.name !== 'drawing' || round.drawerId !== socketId) return
    round.strokes.push(ev)
    // relay to everyone else in the room (the drawer already has it)
    this.io.to(this.code).except(socketId).emit('stroke-event', ev)
  }

  // --- guessing --------------------------------------------------------------------

  guess(socketId: string, text: string): void {
    const round = this.round
    const human = this.humans.find((h) => h.socketId === socketId)
    if (!round || this.phase.name !== 'drawing' || !human) return
    if (socketId === round.drawerId) return // the drawer knows the word
    if (round.correct.has(socketId)) return // no leaking after a correct guess

    const clean = normalizeGuess(text).slice(0, MAX_GUESS_LENGTH)
    if (!clean) return

    if (clean === round.word) {
      this.scoreCorrectGuess(socketId, human.name, false)
      return
    }
    this.pushFeed(socketId, human.name, false, 'guess', clean)
    const maxDistance = round.word.length <= 4 ? 1 : 2
    if (levenshtein(clean, round.word) <= maxDistance) {
      this.io.to(socketId).emit('close-guess', clean)
    }
  }

  /** The AI's guess arrives from the drawer's client, which hosts its eyes. */
  aiGuess(socketId: string, category: string, confidence: number): void {
    const round = this.round
    if (!round || this.phase.name !== 'drawing' || round.drawerId !== socketId) return
    if (round.correct.has(AI_PLAYER_ID)) return

    void confidence // judged by word alone; confidence may get a UI later
    const clean = normalizeGuess(category).slice(0, MAX_GUESS_LENGTH)
    if (!clean) return
    if (clean === round.word) {
      this.scoreCorrectGuess(AI_PLAYER_ID, AI_PLAYER_NAME, true)
    } else {
      this.pushFeed(AI_PLAYER_ID, AI_PLAYER_NAME, true, 'guess', clean)
    }
  }

  private scoreCorrectGuess(playerId: string, name: string, isAi: boolean): void {
    const round = this.round!
    const atMs = Date.now() - round.startedAt
    const tier = round.prompts[round.index].tier
    const points = guessPoints(tier, atMs, ROUND_DURATION_MS)

    round.correct.add(playerId)
    round.gains.set(playerId, (round.gains.get(playerId) ?? 0) + points)
    if (isAi) this.aiScore += points
    else {
      const human = this.humans.find((h) => h.socketId === playerId)
      if (human) human.score += points
    }
    // the drawer earns a cut for a drawing good enough to be guessed
    const drawer = this.humans.find((h) => h.socketId === round.drawerId)
    if (drawer) {
      const cut = drawerCut(points)
      drawer.score += cut
      round.gains.set(drawer.socketId, (round.gains.get(drawer.socketId) ?? 0) + cut)
    }

    this.pushFeed(playerId, name, isAi, 'correct', '', atMs)
    this.broadcast() // scores changed mid-round
    this.maybeFinishRound()
  }

  private maybeFinishRound(): void {
    const round = this.round
    if (!round || this.phase.name !== 'drawing') return
    const guessers = this.humans.filter((h) => h.socketId !== round.drawerId)
    const everyoneGotIt =
      round.correct.has(AI_PLAYER_ID) && guessers.every((g) => round.correct.has(g.socketId))
    if (everyoneGotIt) this.endRound('all-guessed')
  }

  // --- state & plumbing ---------------------------------------------------------------

  private roundMeta(): RoundMeta {
    const round = this.round!
    return {
      roundIndex: round.index,
      totalRounds: round.totalRounds,
      drawerId: round.drawerId,
      tier: round.prompts[round.index].tier,
      mask: round.word.replace(/[^ ]/g, '_'),
      endsAtMs: round.endsAt,
      modifier: round.modifier,
    }
  }

  private state(): RoomState {
    const players: RoomPlayer[] = [
      ...this.humans.map((h) => ({
        id: h.socketId,
        name: h.name,
        isAi: false,
        isHost: h.socketId === this.hostId,
        score: h.score,
      })),
      { id: AI_PLAYER_ID, name: AI_PLAYER_NAME, isAi: true, isHost: false, score: this.aiScore },
    ]
    return {
      code: this.code,
      players,
      phase: this.phase,
      teamHumans: this.humans.reduce((sum, h) => sum + h.score, 0),
      teamAi: this.aiScore,
      chaosLevel: this.chaosLevel,
    }
  }

  private broadcast(): void {
    this.io.to(this.code).emit('room-state', this.state())
  }

  private system(text: string): void {
    this.pushFeed('', 'system', false, 'system', text)
  }

  private pushFeed(
    playerId: string,
    name: string,
    isAi: boolean,
    kind: FeedEntry['kind'],
    text: string,
    atMs?: number,
  ): void {
    const entry: FeedEntry = {
      id: this.feedId++,
      playerId,
      name,
      isAi,
      kind,
      text,
      atMs: atMs ?? (this.round ? Date.now() - this.round.startedAt : 0),
    }
    this.io.to(this.code).emit('feed', entry)
  }

  private setTimer(fn: () => void, ms: number): void {
    this.clearTimer()
    this.pendingTimer = setTimeout(fn, ms)
  }

  private clearTimer(): void {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer)
      this.pendingTimer = null
    }
  }
}

export class RoomManager {
  private rooms = new Map<string, Room>()

  constructor(private readonly io: IoServer) {}

  create(): Room {
    let code: string
    do {
      code = Array.from(
        { length: 4 },
        () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)],
      ).join('')
    } while (this.rooms.has(code))
    const room = new Room(code, this.io, () => this.rooms.delete(code))
    this.rooms.set(code, room)
    return room
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase().trim())
  }
}
