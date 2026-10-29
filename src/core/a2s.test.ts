import { createSocket, type Socket } from 'node:dgram'
import { afterEach, describe, expect, it } from 'vitest'
import { queryPlayers } from './a2s'

function playersReply(players: { name: string; score: number; seconds: number }[]): Buffer {
  const parts = [Buffer.from([0xff, 0xff, 0xff, 0xff, 0x44, players.length])]
  players.forEach((p, i) => {
    const num = Buffer.alloc(8)
    num.writeInt32LE(p.score, 0)
    num.writeFloatLE(p.seconds, 4)
    parts.push(Buffer.from([i]), Buffer.from(p.name + '\0'), num)
  })
  return Buffer.concat(parts)
}

let socket: Socket | undefined
afterEach(() => socket?.close())

describe('queryPlayers', () => {
  it('answers the challenge and parses players', async () => {
    socket = createSocket('udp4')
    const s = socket
    s.on('message', (msg, rinfo) => {
      const challenge = msg.readInt32LE(5)
      const reply = challenge === -1 ? Buffer.from([0xff, 0xff, 0xff, 0xff, 0x41, 1, 2, 3, 4]) : playersReply([{ name: 'Mira', score: 3, seconds: 125.5 }])
      s.send(reply, rinfo.port, rinfo.address)
    })
    await new Promise<void>((r) => s.bind(0, '127.0.0.1', r))
    expect(await queryPlayers(s.address().port)).toEqual([{ name: 'Mira', score: 3, seconds: 125 }])
  })

  it('times out when nobody answers', async () => {
    socket = createSocket('udp4')
    await new Promise<void>((r) => socket!.bind(0, '127.0.0.1', r))
    await expect(queryPlayers(socket.address().port, 300)).rejects.toThrow(/not reachable/)
  })
})
