import { createSocket, type Socket } from 'node:dgram'
import { afterEach, describe, expect, it } from 'vitest'
import { quakeRconExec } from './quake'

// Stands in for a Quake-engine server (Warfork's sv_oob.c): "rcon <password> <command>", answers in "print" packets.
function fakeServer(password: string, reply: (cmd: string) => string[]): Promise<{ socket: Socket; port: number; seen: string[] }> {
  const socket = createSocket('udp4')
  const seen: string[] = []
  socket.on('message', (msg, from) => {
    const text = msg.subarray(4).toString()
    seen.push(text)
    const m = /^rcon (\S+) (.*)$/s.exec(text)
    if (!m) return
    const parts = m[1] === password ? reply(m[2]) : ['Bad rcon_password.\n']
    for (const part of parts) socket.send(Buffer.concat([Buffer.from([255, 255, 255, 255]), Buffer.from(`print\n${part}`)]), from.port, from.address)
  })
  return new Promise((resolve) => socket.bind(0, '127.0.0.1', () => resolve({ socket, port: socket.address().port, seen })))
}

let server: Socket | undefined
afterEach(() => server?.close())

describe('quakeRconExec', () => {
  it('sends rcon with the password and returns the printed reply', async () => {
    const s = await fakeServer('pw', (cmd) => [`ran ${cmd}\n`])
    server = s.socket
    expect(await quakeRconExec({ port: s.port, password: 'pw' }, 'status')).toBe('ran status\n')
    expect(s.seen).toEqual(['rcon pw status'])
  })

  it('joins a reply split over several packets', async () => {
    const s = await fakeServer('pw', () => ['map : wfca1\n', 'num score ping name\n'])
    server = s.socket
    expect(await quakeRconExec({ port: s.port, password: 'pw' }, 'status')).toBe('map : wfca1\nnum score ping name\n')
  })

  it('reports a wrong password', async () => {
    const s = await fakeServer('pw', () => ['secret'])
    server = s.socket
    await expect(quakeRconExec({ port: s.port, password: 'nope' }, 'status')).rejects.toThrow(/password/)
  })

  it('times out when nobody answers', async () => {
    const s = await fakeServer('pw', () => [])
    s.socket.removeAllListeners('message')
    server = s.socket
    await expect(quakeRconExec({ port: s.port, password: 'pw', timeoutMs: 300 }, 'status')).rejects.toThrow(/not reachable/)
  })
})
