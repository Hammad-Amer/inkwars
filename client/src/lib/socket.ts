import { io, type Socket } from 'socket.io-client'
import type { ClientToServerEvents, ServerToClientEvents } from '../../../shared/protocol'

/**
 * The game socket, created on first use. Same-origin: Vite proxies
 * /socket.io to the game server in dev (see vite.config.ts).
 */

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>

let socket: GameSocket | null = null

export function getSocket(): GameSocket {
  socket ??= io()
  // leaving the room page disconnects; coming back revives the same socket
  if (socket.disconnected) socket.connect()
  return socket
}
