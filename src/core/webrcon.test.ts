import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { webRconExec } from './webrcon'

// Just enough of RFC 6455 to stand in for Rust's WebRCON: handshake, masked client text frames, server text frames.
function sendText(socket: Socket, text: string) {
  const payload = Buffer.from(text)
  const header = payload.length < 126 ? Buffer.from([0x81, payload.length]) : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff])
  socket.write(Buffer.concat([header, payload]))
}

function readText(frame: Buffer): string {
  let len = frame[1] & 0x7f
  let offset = 2
  if (len === 126) {
    len = frame.readUInt16BE(2)
    offset = 4
  }
  const mask = frame.subarray(offset, offset + 4)
  const data = frame.subarray(offset + 4, offset + 4 + len)
  return Buffer.from(data.map((b, i) => b ^ mask[i % 4])).toString()
}

type Fake = { server: Server; port: number; upgrades: () => number; dropAll: () => void }

function fakeRust(password: string, reply: (cmd: string) => string, dropFirst = 0): Promise<Fake> {
  const server = createServer()
  const sockets = new Set<Socket>()
  let seen = 0
  server.on('upgrade', (req, socket: Socket) => {
    if (req.url !== `/${password}` || ++seen <= dropFirst) return socket.destroy()
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    socket.on('data', (frame) => {
      if ((frame[0] & 0x0f) !== 1) return
      const msg = JSON.parse(readText(frame))
      sendText(socket, JSON.stringify({ Message: 'Someone: hi', Identifier: 0, Type: 'Chat' }))
      sendText(socket, JSON.stringify({ Message: reply(msg.Message), Identifier: msg.Identifier, Type: 'Generic' }))
    })
  })
  const dropAll = () => sockets.forEach((s) => s.destroy())
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port, upgrades: () => seen, dropAll }))
  )
}

let fake: Fake | undefined
afterEach(() => {
  fake?.dropAll()
  fake?.server.close()
})

describe('webRconExec', () => {
  it('returns the reply that matches the request, skipping chat', async () => {
    const s = await fakeRust('pw', (cmd) => (cmd === 'playerlist' ? '[{"SteamID":"7656","DisplayName":"Mira"}]' : 'unknown'))
    fake = s
    expect(await webRconExec({ port: s.port, password: 'pw' }, 'playerlist')).toBe('[{"SteamID":"7656","DisplayName":"Mira"}]')
  })

  // Seen on a real Rust server right after startup and after server.writecfg: a new connection is dropped before
  // it opens. The command was never sent, so NeledPort can safely try again.
  it('tries again when the connection drops before it opens', async () => {
    const s = await fakeRust('pw', (cmd) => `ran ${cmd}`, 2)
    fake = s
    expect(await webRconExec({ port: s.port, password: 'pw' }, 'unban 7656')).toBe('ran unban 7656')
  })

  it('gives up after three dropped connections', async () => {
    const s = await fakeRust('pw', () => 'ok', 3)
    fake = s
    await expect(webRconExec({ port: s.port, password: 'pw' }, 'status')).rejects.toThrow(/not reachable/)
  })

  // Rust closes new WebRCON connections from an address that opens too many, so NeledPort keeps one open.
  it('sends several commands over one connection', async () => {
    const s = await fakeRust('pw', (cmd) => `ran ${cmd}`)
    fake = s
    expect(await webRconExec({ port: s.port, password: 'pw' }, 'banid 7656')).toBe('ran banid 7656')
    expect(await webRconExec({ port: s.port, password: 'pw' }, 'server.writecfg')).toBe('ran server.writecfg')
    expect(await webRconExec({ port: s.port, password: 'pw' }, 'unban 7656')).toBe('ran unban 7656')
    expect(s.upgrades()).toBe(1)
  })

  it('opens a new connection after the server closed the old one', async () => {
    const s = await fakeRust('pw', (cmd) => `ran ${cmd}`)
    fake = s
    expect(await webRconExec({ port: s.port, password: 'pw' }, 'status')).toBe('ran status')
    s.dropAll()
    await new Promise((r) => setTimeout(r, 50))
    expect(await webRconExec({ port: s.port, password: 'pw' }, 'status')).toBe('ran status')
    expect(s.upgrades()).toBe(2)
  })

  it('fails when the password is wrong', async () => {
    const s = await fakeRust('pw', () => '')
    fake = s
    await expect(webRconExec({ port: s.port, password: 'bad', timeoutMs: 2000 }, 'status')).rejects.toThrow(/not reachable|password/)
  })
})
