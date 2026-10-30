import { createServer, type Server } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { telnetExec } from './telnet'

// Stands in for Soulmask's -EchoPort console: a banner, then each line's reply (some arrive later, like a save).
function fakeConsole(reply: (line: string) => { text: string; afterMs?: number }[]): Promise<{ server: Server; port: number; seen: string[] }> {
  const seen: string[] = []
  const server = createServer((socket) => {
    socket.write('Welcome to the console\r\n')
    socket.setEncoding('utf8')
    socket.on('data', (data: string) => {
      for (const line of data.split('\r\n').filter(Boolean)) {
        seen.push(line)
        for (const { text, afterMs } of reply(line)) setTimeout(() => socket.write(text), afterMs ?? 0)
      }
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port, seen })))
}

let current: Server | undefined
afterEach(() => current?.close())

describe('telnetExec', () => {
  it('sends the command and returns what the console prints until it goes quiet', async () => {
    const c = await fakeConsole((line) => [{ text: `ran ${line}\r\n` }])
    current = c.server
    expect(await telnetExec({ port: c.port }, 'help')).toContain('ran help')
    expect(c.seen).toEqual(['help'])
  })

  it('waits for the text that says the command finished (a save takes a while)', async () => {
    const c = await fakeConsole(() => [{ text: 'saving...\r\n' }, { text: 'world is saved\r\n', afterMs: 1200 }])
    current = c.server
    expect(await telnetExec({ port: c.port, until: /world is saved/i, timeoutMs: 5000 }, 'saveworld 1')).toMatch(/world is saved/)
  })

  it('fails when the finishing text never comes', async () => {
    const c = await fakeConsole(() => [{ text: 'saving...\r\n' }])
    current = c.server
    await expect(telnetExec({ port: c.port, until: /world is saved/i, timeoutMs: 800 }, 'saveworld 1')).rejects.toThrow(/world is saved/)
  })

  it('fails clearly when nothing listens', async () => {
    const c = await fakeConsole(() => [])
    const { port } = c
    c.server.close()
    await expect(telnetExec({ port }, 'help')).rejects.toThrow(/not reachable/)
  })
})
