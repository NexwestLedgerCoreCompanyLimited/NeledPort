import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createApi, type ApiManager, type AuditEntry, type Caller } from './api'
import type { ServerView } from './types'

const server: ServerView = {
  id: 'ab12cd34',
  name: 'Friday Valheim',
  gameId: 'valheim',
  gameName: 'Valheim',
  installDir: '/home/me/NeledPort/servers/valheim-ab12cd34',
  ports: { game: 2456 },
  settings: { serverName: 'Friday', password: 'hunter22' },
  status: 'running',
  gracefulStop: true,
  admin: { players: true, kick: true, ban: true, unban: true, command: false, banOnNextJoin: false },
  build: { installed: '1', latest: '1', updateAvailable: false },
  needsLaunchSetup: false,
  custom: false,
  loaders: [],
  workshop: false,
  launch: { executable: 'valheim_server.x86_64', args: ['-password', 'hunter22'] }
}

function setup() {
  const manager = {
    list: vi.fn(() => [server]),
    get: vi.fn((id: string) => {
      if (id !== server.id) throw new Error('Unknown server')
      return server
    }),
    lines: vi.fn(() => ['line 1', 'line 2', 'line 3']),
    players: vi.fn(async () => [{ id: '7656', name: 'Mira' }]),
    bans: vi.fn(async () => []),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => ({ forced: false })),
    restart: vi.fn(async () => {}),
    update: vi.fn(async () => {}),
    backup: vi.fn(async () => null),
    command: vi.fn(async () => 'ok'),
    kick: vi.fn(async () => {}),
    ban: vi.fn(async () => {}),
    unban: vi.fn(async () => {}),
    create: vi.fn(() => server),
    install: vi.fn(async () => {}),
    remove: vi.fn(() => {})
  } satisfies ApiManager
  const audit: AuditEntry[] = []
  const api = createApi({
    manager,
    games: () => [{ id: 'valheim', name: 'Valheim', tier: 'full', serverAppId: 896660, anonymous: true } as never],
    serversDir: mkdtempSync(join(tmpdir(), 'neledport-api-')),
    version: '0.9.0',
    audit: (e) => audit.push(e),
    owner: { 'devices.list': () => [] }
  })
  return { manager, api, audit }
}

const viewer: Caller = { role: 'view', device: 'phone', address: '203.0.113.5' }
const controller: Caller = { role: 'control', device: 'laptop', address: '203.0.113.6' }
const owner: Caller = { role: 'owner' }

describe('API roles', () => {
  it('lets a viewer see servers without their settings, folders or launch line', async () => {
    const { api } = setup()
    const [s] = (await api(viewer, 'servers.list', {})) as Record<string, unknown>[]
    expect(s).toMatchObject({ id: server.id, name: 'Friday Valheim', gameName: 'Valheim', status: 'running', ports: { game: 2456 }, players: 1 })
    expect(JSON.stringify(s)).not.toMatch(/hunter22|installDir|NeledPort\/servers|valheim_server/)
  })

  it('reports the machine: CPU, memory, disk, uptime and server counts', async () => {
    const { api } = setup()
    const m = (await api(viewer, 'machine.status', {})) as Record<string, any>
    expect(m.version).toBe('0.9.0')
    expect(m.cpu.cores).toBeGreaterThan(0)
    expect(m.cpu.percent).toBeGreaterThanOrEqual(0)
    expect(m.memory.total).toBeGreaterThan(m.memory.free)
    expect(m.disk.total).toBeGreaterThan(0)
    expect(m.servers).toEqual({ total: 1, running: 1 })
  })

  it('keeps control actions from viewers', async () => {
    const { api, manager } = setup()
    await expect(api(viewer, 'servers.stop', { id: server.id })).rejects.toThrow(/not allowed/)
    await expect(api(viewer, 'servers.lines', { id: server.id })).rejects.toThrow(/not allowed/)
    expect(manager.stop).not.toHaveBeenCalled()
  })

  it('lets a controller start, stop and run console commands', async () => {
    const { api, manager } = setup()
    await api(controller, 'servers.stop', { id: server.id })
    expect(manager.stop).toHaveBeenCalledWith(server.id)
    expect(await api(controller, 'servers.command', { id: server.id, command: 'save' })).toBe('ok')
    expect(await api(controller, 'servers.lines', { id: server.id, last: 2 })).toEqual(['line 2', 'line 3'])
  })

  it('keeps creating and removing servers on the machine itself', async () => {
    const { api, manager } = setup()
    await expect(api(controller, 'servers.create', { gameId: 'valheim', name: 'x' })).rejects.toThrow(/not allowed/)
    await expect(api(controller, 'servers.remove', { id: server.id })).rejects.toThrow(/not allowed/)
    await expect(api(controller, 'devices.list', {})).rejects.toThrow(/not allowed/)
    expect(manager.remove).not.toHaveBeenCalled()
    await api(owner, 'servers.remove', { id: server.id })
    expect(manager.remove).toHaveBeenCalledWith(server.id)
    expect(await api(owner, 'devices.list', {})).toEqual([])
  })

  it('creates only catalog games in the default folder, even for the owner', async () => {
    const { api, manager } = setup()
    await api(owner, 'servers.create', { gameId: 'valheim', name: 'New', settings: { serverName: 'New' }, installDir: '/etc' })
    expect(manager.create).toHaveBeenCalledWith({ gameId: 'valheim', name: 'New', settings: { serverName: 'New' } })
    await expect(api(owner, 'servers.create', { gameId: 'custom', name: 'x' })).rejects.toThrow(/Unknown game/)
  })
})

describe('API input checks', () => {
  it('refuses unknown methods and malformed ids', async () => {
    const { api } = setup()
    await expect(api(owner, 'servers.format', {})).rejects.toThrow(/Unknown method/)
    await expect(api(owner, '__proto__', {})).rejects.toThrow(/Unknown method/)
    await expect(api(controller, 'servers.start', { id: '../../etc' })).rejects.toThrow(/Invalid server id/)
    await expect(api(controller, 'servers.start', {})).rejects.toThrow(/Invalid server id/)
  })

  it('takes one console line of reasonable length', async () => {
    const { api, manager } = setup()
    await expect(api(controller, 'servers.command', { id: server.id, command: 'say hi\nquit' })).rejects.toThrow(/one line/)
    await expect(api(controller, 'servers.command', { id: server.id, command: 'x'.repeat(501) })).rejects.toThrow(/one line/)
    expect(manager.command).not.toHaveBeenCalled()
  })

  it('checks players passed to kick and ban', async () => {
    const { api, manager } = setup()
    await expect(api(controller, 'servers.kick', { id: server.id, player: { id: 5 } })).rejects.toThrow(/Invalid player/)
    await api(controller, 'servers.ban', { id: server.id, player: { id: '7656', name: 'Mira' }, reason: 'griefing' })
    expect(manager.ban).toHaveBeenCalledWith(server.id, { id: '7656', name: 'Mira' }, 'griefing')
  })
})

describe('API activity log', () => {
  it('records every action but not plain viewing', async () => {
    const { api, audit } = setup()
    await api(viewer, 'servers.list', {})
    await api(controller, 'servers.restart', { id: server.id })
    await expect(api(viewer, 'servers.stop', { id: server.id })).rejects.toThrow()
    expect(audit).toEqual([
      expect.objectContaining({ device: 'laptop', address: '203.0.113.6', method: 'servers.restart', server: server.id, ok: true }),
      expect.objectContaining({ device: 'phone', method: 'servers.stop', ok: false, error: expect.stringMatching(/not allowed/) })
    ])
  })

  it('records failures from the game too', async () => {
    const { api, audit, manager } = setup()
    manager.start.mockRejectedValueOnce(new Error('Install the server first'))
    await expect(api(controller, 'servers.start', { id: server.id })).rejects.toThrow(/Install the server first/)
    expect(audit[0]).toMatchObject({ method: 'servers.start', ok: false, error: 'Install the server first' })
  })
})
