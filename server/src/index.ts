import { createServer } from 'node:http'
import express from 'express'
import { Server } from 'socket.io'
import type { ClientToServerEvents, ServerToClientEvents } from '../../shared/protocol.js'
import { loadCategories } from './prompts.js'
import { Room, RoomManager, type IoSocket } from './room.js'

/**
 * Drawing Arena game server: Express for plain HTTP, Socket.io for the
 * realtime room/game layer (see shared/protocol.ts for the full contract).
 * In dev the client reaches us through Vite's proxy, so no CORS config.
 */

const app = express()
const httpServer = createServer(app)
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer)
const rooms = new RoomManager(io)

// fail fast if the model manifest (prompt source) is missing
const categories = loadCategories()

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', categories: categories.length })
})

io.on('connection', (socket: IoSocket) => {
  // a socket belongs to at most one room; joining is one-shot per connection
  let room: Room | null = null

  socket.on('create-room', (name, ack) => {
    if (typeof ack !== 'function') return
    if (room) return ack({ ok: false, error: 'already in a room' })
    room = rooms.create()
    const state = room.join(socket, String(name ?? ''))
    ack({ ok: true, playerId: socket.id, state })
  })

  socket.on('join-room', (code, name, ack) => {
    if (typeof ack !== 'function') return
    if (room) return ack({ ok: false, error: 'already in a room' })
    const found = rooms.get(String(code ?? ''))
    if (!found) return ack({ ok: false, error: 'room not found — check the code' })
    room = found
    const state = room.join(socket, String(name ?? ''))
    ack({ ok: true, playerId: socket.id, state })
  })

  socket.on('start-match', () => room?.startMatch(socket.id))
  socket.on('set-chaos', (level) => room?.setChaos(socket.id, level))
  socket.on('stroke-event', (ev) => room?.strokeEvent(socket.id, ev))
  socket.on('guess', (text) => room?.guess(socket.id, String(text ?? '')))
  socket.on('ai-guess', (category, confidence) =>
    room?.aiGuess(socket.id, String(category ?? ''), Number(confidence) || 0),
  )
  socket.on('simul-submit', (strokes, aiTopGuess, aiConfidence) =>
    room?.simulSubmit(socket.id, strokes, String(aiTopGuess ?? ''), Number(aiConfidence) || 0),
  )
  socket.on('simul-vote', (targetId) => room?.simulVote(socket.id, String(targetId ?? '')))
  socket.on('disconnect', () => room?.leave(socket.id))
})

const port = Number(process.env.PORT ?? 3001)
httpServer.listen(port, () => {
  console.log(
    `drawing-arena server listening on http://localhost:${port} (${categories.length} categories)`,
  )
})
