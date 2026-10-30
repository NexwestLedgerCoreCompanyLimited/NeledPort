import { createServer, type Server } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { isleRconExec } from './isle'

// Stands in for The Isle's RCON as the isle-evrima-rcon client speaks it: 0x01 password 0x00, then
// 0x02 <opcode> <params> 0x00 per command.
function fakeIsle(password: string, reply: (opcode: number, params: string) => string): Promise<{ server: Server; port: number; seen: string[] }> {
  const seen: string[] = []
  const server = createServer((socket) => {
    socket.on('data', (data) => {
      const text = data.toString('latin1')
      if (text.charCodeAt(0) === 0x01) {
        seen.push('auth')
        socket.write(text.slice(1, -1) === password ? 'Password Accepted' : 'Password Rejected')
        return
      }
      const opcode = text.charCodeAt(1)
      const params = text.slice(2, -1)
      seen.push(`${opcode.toString(16)} ${params}`)
      socket.write(reply(opcode, params), 'latin1')
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port, seen })))
}

let current: Server | undefined
afterEach(() => current?.close())

describe('isleRconExec', () => {
  it('logs in, then sends the command as its opcode with the parameters', async () => {
    const s = await fakeIsle('pw', () => 'Kicked')
    current = s.server
    expect(await isleRconExec({ port: s.port, password: 'pw' }, 'kick 76561198000000001,afk')).toBe('Kicked')
    expect(s.seen).toEqual(['auth', '30 76561198000000001,afk'])
  })

  it('turns the player list (a line of IDs, then a line of names) into one player per line', async () => {
    const s = await fakeIsle('pw', () => 'PlayerList\n76561198000000001,76561198000000002,\nMira,Rook Bold,\n0002aa,0002bb,\n')
    current = s.server
    expect(await isleRconExec({ port: s.port, password: 'pw' }, 'players')).toBe('76561198000000001 Mira\n76561198000000002 Rook Bold')
  })

  it('refuses commands it has no opcode for', async () => {
    await expect(isleRconExec({ port: 1, password: 'pw' }, 'quit')).rejects.toThrow(/announce/)
  })

  it('reports a wrong password', async () => {
    const s = await fakeIsle('pw', () => '')
    current = s.server
    await expect(isleRconExec({ port: s.port, password: 'nope' }, 'save')).rejects.toThrow(/password/)
  })
})
