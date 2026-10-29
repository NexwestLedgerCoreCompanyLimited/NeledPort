import { createServer, type Server } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { rconExec } from './rcon'

function packet(id: number, type: number, body: string): Buffer {
  const b = Buffer.from(body)
  const buf = Buffer.alloc(14 + b.length)
  buf.writeInt32LE(10 + b.length, 0)
  buf.writeInt32LE(id, 4)
  buf.writeInt32LE(type, 8)
  b.copy(buf, 12)
  return buf
}

// Behaves like srcds: auth reply, output possibly in several packets, mirrors the empty terminator packet.
function fakeServer(password: string, output: string[]): Promise<{ server: Server; port: number }> {
  const server = createServer((socket) => {
    let buf = Buffer.alloc(0)
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d])
      while (buf.length >= 4 && buf.length >= buf.readInt32LE(0) + 4) {
        const size = buf.readInt32LE(0)
        const id = buf.readInt32LE(4)
        const type = buf.readInt32LE(8)
        const body = buf.subarray(12, 4 + size - 2).toString()
        buf = buf.subarray(4 + size)
        if (type === 3) {
          socket.write(packet(id, 0, ''))
          socket.write(packet(body === password ? id : -1, 2, ''))
        } else if (type === 2) {
          for (const part of output) socket.write(packet(id, 0, part))
        } else if (type === 0) {
          socket.write(packet(id, 0, ''))
        }
      }
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port })))
}

let server: Server | undefined
afterEach(() => server?.close())

describe('rconExec', () => {
  it('authenticates and returns the output', async () => {
    const s = await fakeServer('pw', ['players: 2'])
    server = s.server
    expect(await rconExec({ port: s.port, password: 'pw' }, 'status')).toBe('players: 2')
  })

  it('joins output split over several packets', async () => {
    const s = await fakeServer('pw', ['line 1\n', 'line 2\n', 'line 3'])
    server = s.server
    expect(await rconExec({ port: s.port, password: 'pw' }, 'status')).toBe('line 1\nline 2\nline 3')
  })

  it('rejects a wrong password', async () => {
    const s = await fakeServer('pw', [])
    server = s.server
    await expect(rconExec({ port: s.port, password: 'nope' }, 'status')).rejects.toThrow(/password/)
  })

  it('fails clearly when nothing is listening', async () => {
    await expect(rconExec({ port: 1, password: 'pw', timeoutMs: 1000 }, 'status')).rejects.toThrow(/not reachable/)
  })
})
