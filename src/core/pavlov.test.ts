import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { pavlovRconExec } from './pavlov'

// Stands in for Pavlov's RCON (pavlovwiki "Rcon Overview"): "Password: " prompt, MD5 of the password back,
// "Authenticated=1", then one JSON reply ending in CRLF per command line.
function fakePavlov(password: string, reply: (cmd: string) => object): Promise<{ server: Server; port: number; seen: string[] }> {
  const seen: string[] = []
  const md5 = createHash('md5').update(password).digest('hex')
  const server = createServer((socket) => {
    let authed = false
    socket.write('Password: ')
    socket.setEncoding('utf8')
    socket.on('data', (data: string) => {
      for (const line of data.split('\n').filter(Boolean)) {
        seen.push(line)
        if (!authed) {
          authed = line === md5
          socket.write(`Authenticated=${authed ? 1 : 0}\r\n`)
          if (!authed) socket.end()
          continue
        }
        // Long replies arrive in pieces.
        const text = JSON.stringify(reply(line), null, '\t')
        socket.write(text.slice(0, 10))
        setTimeout(() => socket.write(`${text.slice(10)}\r\n`), 50)
      }
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port, seen })))
}

let current: Server | undefined
afterEach(() => current?.close())

describe('pavlovRconExec', () => {
  it('logs in with the MD5 of the password and returns the JSON reply', async () => {
    const p = await fakePavlov('pw', () => ({ PlayerList: [{ Username: 'Mira', UniqueId: '76561198000000001' }] }))
    current = p.server
    const out = await pavlovRconExec({ port: p.port, password: 'pw' }, 'RefreshList')
    expect(JSON.parse(out)).toEqual({ PlayerList: [{ Username: 'Mira', UniqueId: '76561198000000001' }] })
    expect(p.seen).toEqual([createHash('md5').update('pw').digest('hex'), 'RefreshList'])
  })

  it('reports a wrong password', async () => {
    const p = await fakePavlov('pw', () => ({}))
    current = p.server
    await expect(pavlovRconExec({ port: p.port, password: 'nope' }, 'RefreshList')).rejects.toThrow(/password/)
  })

  it('fails clearly when nothing listens', async () => {
    const p = await fakePavlov('pw', () => ({}))
    p.server.close()
    await expect(pavlovRconExec({ port: p.port, password: 'pw' }, 'RefreshList')).rejects.toThrow(/not reachable/)
  })
})
