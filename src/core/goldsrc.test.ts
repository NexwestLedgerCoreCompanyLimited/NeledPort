import { createSocket, type Socket } from 'node:dgram'
import { afterEach, describe, expect, it } from 'vitest'
import { goldsrcRconExec } from './goldsrc'

// Stands in for HLDS: "challenge rcon" first, then "rcon <challenge> "<password>" <command>", output in "l" packets.
function fakeHlds(password: string, reply: (cmd: string) => string[]): Promise<{ socket: Socket; port: number; seen: string[] }> {
  const socket = createSocket('udp4')
  const seen: string[] = []
  const send = (text: string, port: number, address: string) => socket.send(Buffer.concat([Buffer.from([255, 255, 255, 255]), Buffer.from(text)]), port, address)
  socket.on('message', (msg, from) => {
    const text = msg.subarray(4).toString()
    seen.push(text)
    if (text.startsWith('challenge rcon')) return send('challenge rcon 1234567890\n', from.port, from.address)
    const m = /^rcon (\d+) "([^"]*)" (.*)\0$/s.exec(text)
    if (!m) return
    if (m[1] !== '1234567890' || m[2] !== password) return send('lBad rcon_password.\n\0', from.port, from.address)
    for (const part of reply(m[3])) send(`l${part}\0`, from.port, from.address)
  })
  return new Promise((resolve) => socket.bind(0, '127.0.0.1', () => resolve({ socket, port: socket.address().port, seen })))
}

let server: Socket | undefined
afterEach(() => server?.close())

describe('goldsrcRconExec', () => {
  it('asks for a challenge, then runs the command with it', async () => {
    const s = await fakeHlds('pw', (cmd) => [`ran ${cmd}\n`])
    server = s.socket
    expect(await goldsrcRconExec({ port: s.port, password: 'pw' }, 'writeid')).toBe('ran writeid\n')
    expect(s.seen).toEqual(['challenge rcon\n', 'rcon 1234567890 "pw" writeid\0'])
  })

  it('joins output split over several packets (status on a full server)', async () => {
    const s = await fakeHlds('pw', () => ['hostname: x\n', '# 1 "Mira" 2 STEAM_0:1:7 0 00:42 45 0 1.2.3.4:27005\n', '1 users\n'])
    server = s.socket
    expect(await goldsrcRconExec({ port: s.port, password: 'pw' }, 'status')).toBe('hostname: x\n# 1 "Mira" 2 STEAM_0:1:7 0 00:42 45 0 1.2.3.4:27005\n1 users\n')
  })

  it('accepts an empty answer (banid prints nothing)', async () => {
    const s = await fakeHlds('pw', () => [''])
    server = s.socket
    expect(await goldsrcRconExec({ port: s.port, password: 'pw' }, 'banid 0 STEAM_0:1:7 kick')).toBe('')
  })

  it('reports a wrong password', async () => {
    const s = await fakeHlds('pw', () => ['secret'])
    server = s.socket
    await expect(goldsrcRconExec({ port: s.port, password: 'nope' }, 'status')).rejects.toThrow(/password/)
  })

  it('times out when nobody answers', async () => {
    const s = await fakeHlds('pw', () => [])
    s.socket.removeAllListeners('message')
    server = s.socket
    await expect(goldsrcRconExec({ port: s.port, password: 'pw', timeoutMs: 300 }, 'status')).rejects.toThrow(/not reachable/)
  })
})
