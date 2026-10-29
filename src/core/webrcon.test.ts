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

function fakeRust(password: string, reply: (cmd: string) => string): Promise<{ server: Server; port: number }> {
  const server = createServer()
  server.on('upgrade', (req, socket: Socket) => {
    if (req.url !== `/${password}`) return socket.destroy()
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    socket.on('data', (frame) => {
      if ((frame[0] & 0x0f) !== 1) return
      const msg = JSON.parse(readText(frame))
      sendText(socket, JSON.stringify({ Message: 'Someone: hi', Identifier: 0, Type: 'Chat' }))
      sendText(socket, JSON.stringify({ Message: reply(msg.Message), Identifier: msg.Identifier, Type: 'Generic' }))
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port })))
}

let server: Server | undefined
afterEach(() => server?.close())

describe('webRconExec', () => {
  it('returns the reply that matches the request, skipping chat', async () => {
    const s = await fakeRust('pw', (cmd) => (cmd === 'playerlist' ? '[{"SteamID":"7656","DisplayName":"Mira"}]' : 'unknown'))
    server = s.server
    expect(await webRconExec({ port: s.port, password: 'pw' }, 'playerlist')).toBe('[{"SteamID":"7656","DisplayName":"Mira"}]')
  })

  it('fails when the password is wrong', async () => {
    const s = await fakeRust('pw', () => '')
    server = s.server
    await expect(webRconExec({ port: s.port, password: 'bad', timeoutMs: 2000 }, 'status')).rejects.toThrow(/not reachable|password/)
  })
})
