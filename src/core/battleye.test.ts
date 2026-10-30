import { createSocket, type Socket } from 'node:dgram'
import { crc32 } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { battleyeExec } from './battleye'

// BattlEye RCon v2 (battleye.com/downloads/BERConProtocol.txt): 'B' 'E' CRC32(LE) of the rest, 0xFF, then the payload.
function bePacket(payload: Buffer): Buffer {
  const rest = Buffer.concat([Buffer.from([0xff]), payload])
  const crc = Buffer.alloc(4)
  crc.writeUInt32LE(crc32(rest))
  return Buffer.concat([Buffer.from('BE'), crc, rest])
}

// Stands in for a DayZ / Arma 3 server's BE RCon: login, numbered commands, replies in parts, a server message to ack.
function fakeBattlEye(password: string, reply: (cmd: string) => string[]): Promise<{ socket: Socket; port: number; seen: string[]; acked: number[] }> {
  const socket = createSocket('udp4')
  const seen: string[] = []
  const acked: number[] = []
  socket.on('message', (msg, from) => {
    const send = (payload: Buffer) => socket.send(bePacket(payload), from.port, from.address)
    if (msg.toString('latin1', 0, 2) !== 'BE' || msg.readUInt32LE(2) !== crc32(msg.subarray(6))) return
    const payload = msg.subarray(7)
    if (payload[0] === 0x00) {
      seen.push('login')
      send(Buffer.from([0x00, payload.subarray(1).toString() === password ? 1 : 0]))
      // A console message arrives too, and must be acknowledged.
      send(Buffer.concat([Buffer.from([0x02, 0x00]), Buffer.from('Player #3 connected')]))
    } else if (payload[0] === 0x02) {
      acked.push(payload[1])
    } else if (payload[0] === 0x01) {
      const seq = payload[1]
      const cmd = payload.subarray(2).toString()
      seen.push(`${seq} ${cmd}`)
      const parts = reply(cmd)
      if (parts.length < 2) send(Buffer.concat([Buffer.from([0x01, seq]), Buffer.from(parts[0] ?? '')]))
      else parts.forEach((part, i) => send(Buffer.concat([Buffer.from([0x01, seq, 0x00, parts.length, i]), Buffer.from(part)])))
    }
  })
  return new Promise((resolve) => socket.bind(0, '127.0.0.1', () => resolve({ socket, port: socket.address().port, seen, acked })))
}

let server: Socket | undefined
afterEach(() => server?.close())

describe('battleyeExec', () => {
  it('logs in, runs the command and acknowledges server messages', async () => {
    const s = await fakeBattlEye('pw', (cmd) => [`ran ${cmd}`])
    server = s.socket
    expect(await battleyeExec({ port: s.port, password: 'pw' }, 'players')).toBe('ran players')
    expect(s.seen).toEqual(['login', '0 players'])
    // The acknowledgement may still be in flight when the reply resolves.
    await new Promise((r) => setTimeout(r, 50))
    expect(s.acked).toEqual([0])
  })

  it('joins a reply sent in several packets, in order', async () => {
    const s = await fakeBattlEye('pw', () => ['Players on server:\n', '0   1.2.3.4:2304   31   ', 'abc(OK) Mira\n(1 players in total)'])
    server = s.socket
    expect(await battleyeExec({ port: s.port, password: 'pw' }, 'players')).toBe('Players on server:\n0   1.2.3.4:2304   31   abc(OK) Mira\n(1 players in total)')
  })

  it('reports a wrong password', async () => {
    const s = await fakeBattlEye('pw', () => [''])
    server = s.socket
    await expect(battleyeExec({ port: s.port, password: 'nope' }, 'players')).rejects.toThrow(/password/)
  })

  it('times out when RCon is off (the server does not answer the login)', async () => {
    const s = await fakeBattlEye('pw', () => [''])
    s.socket.removeAllListeners('message')
    server = s.socket
    await expect(battleyeExec({ port: s.port, password: 'pw', timeoutMs: 300 }, 'players')).rejects.toThrow(/not reachable/)
  })
})
