import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadCatalog } from './catalog'
import { ServerManager, type ManagerDeps, type ProcessLike } from './manager'
import type { LaunchSpec, ProcessState } from './process'
import type { Platform } from './types'

const games = loadCatalog(join(__dirname, '../../games')).games

class FakeProcess extends EventEmitter implements ProcessLike {
  state: ProcessState = 'stopped'
  lastExitCode: number | null = null
  spec?: LaunchSpec
  written: string[] = []
  constructor(private log: string[]) {
    super()
  }
  start(spec: LaunchSpec) {
    this.spec = spec
    this.log.push('start')
    this.set('running')
  }
  write(text: string) {
    this.written.push(text)
  }
  interrupt() {
    this.log.push('interrupt')
    return true
  }
  async stop(o: { graceful?: () => unknown; timeoutMs: number }) {
    this.log.push(`stop(timeout=${o.timeoutMs})`)
    await o.graceful?.()
    this.set('stopped')
    return { forced: false }
  }
  lines() {
    return []
  }
  crash(code: number) {
    this.lastExitCode = code
    this.set('crashed')
  }
  private set(s: ProcessState) {
    this.state = s
    this.emit('state', s)
  }
}

function setup(platform: Platform = 'linux', opts: { busyPorts?: number[]; installFails?: boolean } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'mgr-'))
  const log: string[] = []
  const processes: FakeProcess[] = []
  const restCalls: string[] = []
  const deps: ManagerDeps = {
    dataDir,
    serversDir: join(dataDir, 'servers'),
    platform,
    games: () => games,
    secrets: { encrypt: (s) => `enc:${s}`, decrypt: (s) => s.replace(/^enc:/, '') },
    steamcmd: {
      ensure: async () => 'steamcmd',
      run: async (_exe, args, onLine) => {
        log.push(`steamcmd ${args.includes('validate') ? 'validate' : 'install'}`)
        onLine(' Update state (0x61) downloading, progress: 42.00 (1 / 2)')
        if (opts.installFails) return { ok: false, error: 'ERROR! Failed to install app (Disk write failure)' }
        const dir = args[1]
        mkdirSync(dir, { recursive: true })
        for (const p of Object.values(games.find((g) => g.serverAppId === Number(args[5]))!.platforms)) {
          writeFileSync(join(dir, p!.executable), '')
        }
        writeFileSync(join(dir, 'DefaultPalWorldSettings.ini'), 'OptionSettings=(ServerName="x",AdminPassword="",RESTAPIEnabled=False)\n')
        return { ok: true }
      }
    },
    createProcess: () => {
      const p = new FakeProcess(log)
      processes.push(p)
      return p
    },
    portFree: async (port) => !(opts.busyPorts ?? []).includes(port),
    rest: (o) => ({
      save: async () => void restCalls.push(`save as ${o.username}:${o.password}`),
      shutdown: async () => void restCalls.push('shutdown')
    })
  }
  return { manager: new ServerManager(deps), dataDir, log, processes, restCalls }
}

const valheim = { gameId: 'valheim', name: 'Viking Night', settings: { serverName: 'Viking Night', world: 'Midgard', password: 'secret1' } }

describe('ServerManager', () => {
  it('creates a server with defaults and keeps secrets encrypted', () => {
    const { manager, dataDir } = setup()
    const view = manager.create(valheim)
    expect(view.status).toBe('not-installed')
    expect(view.ports).toEqual({ game: 2456, query: 2457 })
    expect(JSON.stringify(view)).not.toContain('secret1')
    expect(readFileSync(join(dataDir, 'servers.json'), 'utf8')).toContain('enc:secret1')
  })

  it('rejects settings that break the definition rules', () => {
    const { manager } = setup()
    expect(() => manager.create({ ...valheim, settings: { ...valheim.settings, password: '123' } })).toThrow(/at least 5/)
    expect(() => manager.create({ ...valheim, gameId: 'nope' })).toThrow(/Unknown game/)
  })

  it('installs with progress and becomes stopped', async () => {
    const { manager } = setup()
    const { id } = manager.create(valheim)
    const progress: number[] = []
    manager.on('changed', (v) => v.progress !== undefined && progress.push(v.progress))
    await manager.install(id)
    expect(progress).toContain(42)
    expect(manager.get(id).status).toBe('stopped')
  })

  it('shows the SteamCMD error when an install fails', async () => {
    const { manager } = setup('linux', { installFails: true })
    const { id } = manager.create(valheim)
    await expect(manager.install(id)).rejects.toThrow(/Disk write failure/)
    expect(manager.get(id).status).toBe('not-installed')
    expect(manager.get(id).message).toMatch(/Disk write failure/)
  })

  it('starts with expanded arguments and the real password', async () => {
    const { manager, processes } = setup()
    const { id, installDir } = manager.create(valheim)
    await manager.install(id)
    await manager.start(id)
    const spec = processes[0].spec!
    expect(spec.command).toBe(join(installDir, 'valheim_server.x86_64'))
    expect(spec.args).toEqual(expect.arrayContaining(['-password', 'secret1', '-world', 'Midgard', '-port', '2456']))
    expect(spec.env).toEqual({ LD_LIBRARY_PATH: `${installDir}/linux64`, SteamAppId: '892970' })
    expect(manager.get(id).status).toBe('running')
  })

  it('refuses to start when a port is busy', async () => {
    const { manager, processes } = setup('linux', { busyPorts: [2456] })
    const { id } = manager.create(valheim)
    await manager.install(id)
    await expect(manager.start(id)).rejects.toThrow(/2456\/udp is already in use/)
    expect(processes).toHaveLength(0)
  })

  it('stops Palworld through the REST API with the generated admin password', async () => {
    const { manager, restCalls } = setup()
    const { id, installDir } = manager.create({ gameId: 'palworld', name: 'Friends', settings: { serverName: 'Friends', maxPlayers: '8' } })
    await manager.install(id)
    await manager.start(id)
    const ini = readFileSync(join(installDir, 'Pal/Saved/Config/LinuxServer/PalWorldSettings.ini'), 'utf8')
    const admin = /AdminPassword="([^"]+)"/.exec(ini)![1]
    expect(admin.length).toBeGreaterThanOrEqual(16)
    await manager.stop(id)
    expect(restCalls).toEqual([`save as admin:${admin}`, 'shutdown'])
    expect(manager.get(id).status).toBe('stopped')
  })

  it('updates in the safe order: backup, stop, update, start', async () => {
    const { manager, log } = setup()
    const { id, installDir } = manager.create(valheim)
    await manager.install(id)
    await manager.start(id)
    mkdirSync(join(installDir, 'saves', 'worlds_local'), { recursive: true })
    writeFileSync(join(installDir, 'saves', 'worlds_local', 'Midgard.db'), 'world')
    log.length = 0
    await manager.update(id)
    expect(log).toEqual(['stop(timeout=60000)', 'interrupt', 'steamcmd validate', 'start'])
    expect(manager.backups(id).map((b) => b.reason)).toEqual(['update'])
    expect(manager.get(id).status).toBe('running')
  })

  it('on Windows, backs up then stops at once for signal-only games', async () => {
    const { manager, log } = setup('windows')
    const { id, installDir } = manager.create(valheim)
    await manager.install(id)
    await manager.start(id)
    mkdirSync(join(installDir, 'saves'), { recursive: true })
    log.length = 0
    await manager.stop(id)
    expect(log).toEqual(['stop(timeout=0)'])
    expect(manager.backups(id).map((b) => b.reason)).toEqual(['stop'])
  })

  it('marks a crash and keeps the exit code', async () => {
    const { manager, processes } = setup()
    const { id } = manager.create(valheim)
    await manager.install(id)
    await manager.start(id)
    processes[0].crash(139)
    expect(manager.get(id).status).toBe('crashed')
    expect(manager.get(id).message).toMatch(/139/)
  })

  it('reloads servers from disk', async () => {
    const first = setup()
    const { id } = first.manager.create(valheim)
    const again = new ServerManager({ ...(first.manager as unknown as { deps: ManagerDeps }).deps })
    expect(again.list().map((s) => s.id)).toEqual([id])
    expect(existsSync(join(first.dataDir, 'servers.json'))).toBe(true)
  })
})
