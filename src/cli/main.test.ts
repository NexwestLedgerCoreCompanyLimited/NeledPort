import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiManager } from '../core/api'
import { startHost, type Host } from '../core/host'
import { dataDirFor, parseCommand, run } from './main'

describe('parseCommand', () => {
  it('reads a command with its arguments and flags', () => {
    expect(parseCommand(['create', 'valheim', 'Friday night', '--set', 'serverName=Friday', '--set', 'password=a=b'])).toMatchObject({
      command: 'create',
      args: ['valheim', 'Friday night'],
      settings: { serverName: 'Friday', password: 'a=b' }
    })
    expect(parseCommand(['devices', 'add', 'Laptop', '--role', 'control'])).toMatchObject({ command: 'devices', args: ['add', 'Laptop'], flags: { role: 'control' } })
    expect(parseCommand(['cmd', 'ab12cd34', 'say', 'hello', 'all'])).toMatchObject({ command: 'cmd', args: ['ab12cd34', 'say', 'hello', 'all'] })
    expect(parseCommand(['list', '--machine', '203.0.113.5', '--json'])).toMatchObject({ command: 'list', flags: { machine: '203.0.113.5', json: true } })
    expect(parseCommand(['serve', '--start', 'Friday Valheim', '--start', 'ab12cd34'])).toMatchObject({ command: 'serve', start: ['Friday Valheim', 'ab12cd34'] })
  })

  it('shows help for nothing or help, and refuses unknown commands and flags', () => {
    expect(parseCommand([]).command).toBe('help')
    expect(parseCommand(['--help']).command).toBe('help')
    expect(parseCommand(['--version']).command).toBe('version')
    expect(() => parseCommand(['format'])).toThrow(/Unknown command: format/)
    expect(() => parseCommand(['list', '--rm'])).toThrow(/--rm/)
    expect(() => parseCommand(['create', 'valheim', 'x', '--set', 'novalue'])).toThrow(/key=value/)
  })
})

describe('dataDirFor', () => {
  it('uses the folder the desktop app keeps its data in', () => {
    // join() uses the separators of the system running the test (CI runs it on Windows too).
    expect(dataDirFor('linux', '/home/mira', {})).toBe(join('/home/mira', '.config', 'NeledPort'))
    expect(dataDirFor('linux', '/home/mira', { XDG_CONFIG_HOME: '/cfg' })).toBe(join('/cfg', 'NeledPort'))
    expect(dataDirFor('win32', 'C:\\Users\\mira', { APPDATA: 'C:\\Users\\mira\\AppData\\Roaming' })).toMatch(/Roaming[\\/]NeledPort$/)
    expect(dataDirFor('linux', '/home/mira', { NELEDPORT_DATA: '/srv/np' })).toBe('/srv/np')
  })
})

describe('run against a running NeledPort', () => {
  let host: Host | undefined
  afterEach(async () => {
    await host?.close()
    host = undefined
  })

  async function setup() {
    const dataDir = mkdtempSync(join(tmpdir(), 'neledport-cli-'))
    const view = { id: 'ab12cd34', name: 'Friday Valheim', gameId: 'valheim', gameName: 'Valheim', status: 'running', ports: { game: 2456 }, admin: { players: false }, build: {} }
    const manager = {
      list: vi.fn(() => [view]),
      get: vi.fn(() => view),
      stop: vi.fn(async () => ({ forced: false })),
      lines: vi.fn(() => [])
    } as unknown as ApiManager
    host = await startHost({ dataDir, serversDir: dataDir, manager, games: () => [], version: '0.9.0' })
    const out: string[] = []
    const io = { out: (t: string) => out.push(t), err: (t: string) => out.push(t) }
    return { dataDir, manager, out, io, env: { NELEDPORT_DATA: dataDir } }
  }

  it('lists servers', async () => {
    const { out, io, env } = await setup()
    expect(await run(['list'], env, io)).toBe(0)
    expect(out.join('\n')).toMatch(/ab12cd34\s+Friday Valheim\s+Valheim\s+running/)
  })

  it('finds a server by its name as well as its id', async () => {
    const { out, io, env, manager } = await setup()
    expect(await run(['stop', 'friday valheim'], env, io)).toBe(0)
    expect(manager.stop).toHaveBeenCalledWith('ab12cd34')
    expect(out.join('\n')).toMatch(/stopped/i)
  })

  it('pairs a device and prints its code once, with how to use it', async () => {
    const { out, io, env } = await setup()
    expect(await run(['devices', 'add', 'Office PC', '--role', 'control'], env, io)).toBe(0)
    expect(out.join('\n')).toMatch(/np1\.[0-9a-f]{8}\./)
    expect(out.join('\n')).toMatch(/remote access is off/i)
  })

  it('exits with 1 and a readable message on errors', async () => {
    const { out, io, env } = await setup()
    expect(await run(['stop', 'no such server'], env, io)).toBe(1)
    expect(out.join('\n')).toMatch(/No server called "no such server"/)
  })

  it('says plainly that NeledPort already runs, instead of a stack trace', async () => {
    const { out, io, env } = await setup()
    expect(await run(['serve'], env, io)).toBe(1)
    expect(out.join('\n')).toMatch(/^NeledPort is already running/m)
    expect(out.join('\n')).not.toMatch(/\n\s+at /)
  })

  it('tells the user to start NeledPort when it is not running', async () => {
    const out: string[] = []
    const env = { NELEDPORT_DATA: mkdtempSync(join(tmpdir(), 'neledport-cli-')) }
    expect(await run(['list'], env, { out: (t) => out.push(t), err: (t) => out.push(t) })).toBe(1)
    expect(out.join('\n')).toMatch(/neledport serve/)
  })
})
