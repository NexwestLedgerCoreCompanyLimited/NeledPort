import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ServerProcess, type LaunchSpec } from './process'

// A tiny stand-in for a game server: prints, answers "quit" on stdin, optionally ignores it or crashes.
const FAKE = `
const mode = process.argv[1] || 'normal'
console.log('booting')
setTimeout(() => console.log('Game server connected'), 50)
if (mode === 'crash') setTimeout(() => process.exit(3), 100)
process.on('SIGINT', () => { console.log('saving world'); process.exit(0) })
process.stdin.on('data', (d) => {
  if (String(d).trim() === 'quit' && mode !== 'stubborn') { console.log('bye'); process.exit(0) }
})
setInterval(() => {}, 1000)
`

const spec = (mode = 'normal'): LaunchSpec => ({ command: process.execPath, args: ['-e', FAKE, mode], cwd: tmpdir() })
const waitFor = (p: ServerProcess, state: string) =>
  new Promise<void>((resolve) => {
    if (p.state === state) return resolve()
    const on = (s: string) => s === state && (p.off('state', on), resolve())
    p.on('state', on)
  })

const procs: ServerProcess[] = []
afterEach(async () => {
  for (const p of procs.splice(0)) await p.stop({ timeoutMs: 200 })
})
function make(opts: ConstructorParameters<typeof ServerProcess>[0] = {}) {
  const p = new ServerProcess(opts)
  procs.push(p)
  return p
}

describe('ServerProcess', () => {
  it('streams output and becomes running on the ready line', async () => {
    const p = make({ readyPattern: /Game server connected/ })
    p.start(spec())
    expect(p.state).toBe('starting')
    await waitFor(p, 'running')
    expect(p.lines()).toEqual(['booting', 'Game server connected'])
  })

  it('stops gracefully when the server exits on its own', async () => {
    const p = make()
    p.start(spec())
    await waitFor(p, 'running')
    const result = await p.stop({ graceful: () => p.write('quit'), timeoutMs: 5000 })
    expect(result).toEqual({ forced: false })
    expect(p.state).toBe('stopped')
    expect(p.lines()).toContain('bye')
  })

  it('forces a stop after the timeout', async () => {
    const p = make()
    p.start(spec('stubborn'))
    await waitFor(p, 'running')
    const result = await p.stop({ graceful: () => p.write('quit'), timeoutMs: 300 })
    expect(result).toEqual({ forced: true })
    expect(p.state).toBe('stopped')
    expect(p.lines().at(-1)).toMatch(/forced/i)
  })

  // Windows signal-only games (Valheim) are closed at once on purpose, after a backup: no "did not stop in time".
  it('closes at once without calling it a timeout when asked for no wait', async () => {
    const p = make()
    p.start(spec('stubborn'))
    await waitFor(p, 'running')
    expect(await p.stop({ timeoutMs: 0 })).toEqual({ forced: true })
    expect(p.lines().join('\n')).not.toMatch(/did not stop in time/)
    expect(p.lines().at(-1)).toMatch(/Closing the server now/)
  })

  it('reports a crash', async () => {
    const p = make()
    p.start(spec('crash'))
    await waitFor(p, 'crashed')
    expect(p.lastExitCode).toBe(3)
  })

  it('refuses to start twice', () => {
    const p = make()
    p.start(spec())
    expect(() => p.start(spec())).toThrow(/already/)
  })

  it('writes the log file', async () => {
    const logFile = join(mkdtempSync(join(tmpdir(), 'proc-')), 'server.log')
    const p = make({ logFile, readyPattern: /Game server connected/ })
    p.start(spec())
    await waitFor(p, 'running')
    await p.stop({ graceful: () => p.write('quit'), timeoutMs: 5000 })
    expect(readFileSync(logFile, 'utf8')).toContain('Game server connected')
  })

  it('keeps only the newest lines', async () => {
    const p = make({ maxLines: 1, readyPattern: /Game server connected/ })
    p.start(spec())
    await waitFor(p, 'running')
    expect(p.lines()).toEqual(['Game server connected'])
  })

  it.skipIf(process.platform === 'win32')('interrupt sends SIGINT so the server can save', async () => {
    const p = make({ readyPattern: /Game server connected/ })
    p.start(spec())
    await waitFor(p, 'running')
    const result = await p.stop({ graceful: () => p.interrupt(), timeoutMs: 5000 })
    expect(result.forced).toBe(false)
    expect(p.lines()).toContain('saving world')
  })
})
