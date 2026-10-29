import { createSocket } from 'node:dgram'

export interface A2sPlayer {
  name: string
  score: number
  seconds: number
}

const HEADER = [0xff, 0xff, 0xff, 0xff]
const A2S_PLAYER = 0x55
const S2C_CHALLENGE = 0x41
const S2A_PLAYER = 0x44

function request(challenge: Buffer): Buffer {
  return Buffer.concat([Buffer.from([...HEADER, A2S_PLAYER]), challenge])
}

function parsePlayers(msg: Buffer): A2sPlayer[] {
  const count = msg[5]
  const players: A2sPlayer[] = []
  let at = 6
  for (let i = 0; i < count && at < msg.length; i++) {
    at += 1 // index
    const end = msg.indexOf(0, at)
    const name = msg.subarray(at, end).toString('utf8')
    at = end + 1
    const score = msg.readInt32LE(at)
    const seconds = Math.floor(msg.readFloatLE(at + 4))
    at += 8
    players.push({ name, score, seconds })
  }
  return players
}

/** Steam server query (A2S_PLAYER) on the query port. */
export function queryPlayers(port: number, timeoutMs = 3000): Promise<A2sPlayer[]> {
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4')
    const done = (err: Error | null, players?: A2sPlayer[]) => {
      clearTimeout(timer)
      socket.close()
      if (err) reject(err)
      else resolve(players ?? [])
    }
    const timer = setTimeout(() => done(new Error('Server query is not reachable (timed out)')), timeoutMs)
    socket.on('error', (e) => done(new Error(`Server query is not reachable: ${e.message}`)))
    socket.on('message', (msg) => {
      // shortcut: split (multi-packet) replies are not handled; they only occur with very large player lists.
      if (msg.readInt32LE(0) !== -1) return done(new Error('Split query replies are not supported yet'))
      if (msg[4] === S2C_CHALLENGE) socket.send(request(msg.subarray(5, 9)), port, '127.0.0.1')
      else if (msg[4] === S2A_PLAYER) done(null, parsePlayers(msg))
    })
    const first = Buffer.alloc(4)
    first.writeInt32LE(-1)
    socket.send(request(first), port, '127.0.0.1')
  })
}
