import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadCatalog, validateDefinition } from './catalog'
import { makeZip } from './testing/zip'
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

function setup(platform: Platform = 'linux', opts: { busyPorts?: number[]; installFails?: boolean; appInfo?: string } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'mgr-'))
  const log: string[] = []
  const processes: FakeProcess[] = []
  const restCalls: string[] = []
  const steamArgs: string[][] = []
  const deps: ManagerDeps = {
    dataDir,
    serversDir: join(dataDir, 'servers'),
    platform,
    games: () => games,
    secrets: { encrypt: (s) => `enc:${s}`, decrypt: (s) => s.replace(/^enc:/, '') },
    steamcmd: {
      ensure: async () => 'steamcmd',
      capture: async () => opts.appInfo ?? '',
      run: async (_exe, args, onLine) => {
        steamArgs.push(args)
        log.push(`steamcmd ${args.includes('validate') ? 'validate' : 'install'}`)
        onLine(' Update state (0x61) downloading, progress: 42.00 (1 / 2)')
        if (opts.installFails) return { ok: false, error: 'ERROR! Failed to install app (Disk write failure)' }
        const dir = args[1]
        mkdirSync(join(dir, 'steamapps'), { recursive: true })
        writeFileSync(join(dir, 'steamapps', `appmanifest_${args[5]}.acf`), '"AppState" { "buildid" "1" }')
        for (const p of Object.values(games.find((g) => g.serverAppId === Number(args[5]))?.platforms ?? {})) {
          mkdirSync(join(dir, p!.executable, '..'), { recursive: true })
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
    net: {
      webrcon: async (o, cmd) => (restCalls.push(`web:${cmd}`), cmd === 'status' ? 'hostname: test\nplayers : 0' : ''),
      rcon: async (o, cmd) => (restCalls.push(`rcon:${cmd}`), '')
    },
    download: async (url) => {
      log.push(`download ${url.split('/').pop() || url}`)
      return url.includes('thunderstore')
        ? makeZip([{ name: 'BepInExPack_Valheim/BepInEx/core/BepInEx.Preloader.dll', text: 'bep' }, { name: 'BepInExPack_Valheim/winhttp.dll', text: 'w' }])
        : makeZip([{ name: 'RustDedicated_Data/Managed/Assembly-CSharp.dll', text: 'patched' }, { name: 'RustDedicated_Data/Managed/Oxide.Core.dll', text: 'o' }])
    },
    rest: (o) => ({
      save: async () => void restCalls.push(`save as ${o.username}:${o.password}`),
      shutdown: async () => void restCalls.push('shutdown')
    })
  }
  return { manager: new ServerManager(deps), deps, dataDir, log, processes, restCalls, steamArgs }
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

  it('ignores a second start while the first is still starting', async () => {
    const { manager, processes } = setup()
    const { id } = manager.create(valheim)
    await manager.install(id)
    const first = manager.start(id)
    await expect(manager.start(id)).rejects.toThrow(/still busy/)
    await first
    expect(processes).toHaveLength(1)
  })

  it('refuses a second install while one is running', async () => {
    const { manager, log } = setup()
    const { id } = manager.create(valheim)
    const first = manager.install(id)
    await expect(manager.install(id)).rejects.toThrow(/still busy/)
    await first
    expect(log.filter((l) => l.startsWith('steamcmd'))).toHaveLength(1)
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

  it('runs console commands over WebRCON and echoes them', async () => {
    const { manager, restCalls } = setup()
    const { id } = manager.create({ gameId: 'rust', name: 'Wasteland', settings: { serverName: 'Wasteland' } })
    await manager.install(id)
    await manager.start(id)
    expect(await manager.command(id, 'status')).toBe('hostname: test\nplayers : 0')
    expect(manager.lines(id).slice(-3)).toEqual(['> status', 'hostname: test', 'players : 0'])
    expect(restCalls).toEqual(['web:status'])
  })

  it('stops Rust by saving and quitting over WebRCON', async () => {
    const { manager, restCalls } = setup()
    const { id } = manager.create({ gameId: 'rust', name: 'Wasteland', settings: { serverName: 'Wasteland' } })
    await manager.install(id)
    await manager.start(id)
    await manager.stop(id)
    expect(restCalls).toEqual(['web:server.save', 'web:quit'])
  })

  it('passes the generated admin password to the server', async () => {
    const { manager, processes } = setup()
    const { id } = manager.create({ gameId: 'rust', name: 'Wasteland', settings: { serverName: 'Wasteland' } })
    await manager.install(id)
    await manager.start(id)
    const args = processes[0].spec!.args
    expect(args[args.indexOf('+rcon.password') + 1]).toMatch(/^[\w-]{24}$/)
  })

  it('bans through the ban file and lists bans while stopped', async () => {
    const { manager } = setup()
    const { id } = manager.create(valheim)
    await manager.ban(id, { id: '7656001', name: 'Mira' })
    expect(await manager.bans(id)).toEqual([{ id: '7656001' }])
    await manager.unban(id, '7656001')
    expect(await manager.bans(id)).toEqual([])
    expect(manager.get(id).admin).toMatchObject({ ban: true, kick: false, banOnNextJoin: true })
  })

  it('needs a running server for the player list and console', async () => {
    const { manager } = setup()
    const { id } = manager.create(valheim)
    await expect(manager.players(id)).rejects.toThrow(/Start the server/)
    await expect(manager.command(id, 'help')).rejects.toThrow(/Start the server/)
  })

  it('reports an available update', async () => {
    const appInfo = '"896660" { "depots" { "branches" { "public" { "buildid" "200" } } } }'
    const { manager } = setup('linux', { appInfo })
    const { id, installDir } = manager.create(valheim)
    await manager.install(id)
    mkdirSync(join(installDir, 'steamapps'), { recursive: true })
    writeFileSync(join(installDir, 'steamapps', 'appmanifest_896660.acf'), '"AppState" { "buildid" "100" }')
    expect(await manager.checkBuild(id)).toEqual({ installed: '100', latest: '200', updateAvailable: true })
  })

  it('says it could not check instead of "up to date" when Steam gives nothing', async () => {
    const { manager } = setup('linux', { appInfo: 'No app info' })
    const { id } = manager.create(valheim)
    const build = await manager.checkBuild(id)
    expect(build.updateAvailable).toBe(false)
    expect(build.error).toMatch(/Could not check/)
  })

  it('hosts any App ID and asks for the program after install', async () => {
    const { manager, processes } = setup()
    const view = manager.create({ gameId: 'custom', name: 'My Server', custom: { appId: 999999, name: 'Some Game' }, ports: { game: 27016 }, settings: {} })
    expect(view).toMatchObject({ status: 'not-installed', custom: true, gameName: 'Some Game' })
    await manager.install(view.id)
    expect(manager.get(view.id)).toMatchObject({ status: 'stopped', needsLaunchSetup: true })
    await expect(manager.start(view.id)).rejects.toThrow(/Choose the program/)

    mkdirSync(join(view.installDir, 'bin'), { recursive: true })
    writeFileSync(join(view.installDir, 'bin', 'srv'), '')
    manager.setLaunch(view.id, join(view.installDir, 'bin', 'srv'), '-port {port:game} -name "My Server"')
    expect(manager.get(view.id).needsLaunchSetup).toBe(false)
    await manager.start(view.id)
    expect(processes[0].spec).toMatchObject({ command: join(view.installDir, 'bin/srv'), args: ['-port', '27016', '-name', 'My Server'] })
  })

  it('refuses a program outside the server folder', async () => {
    const { manager } = setup()
    const { id, installDir } = manager.create({ gameId: 'custom', name: 'X', custom: { appId: 5, name: 'X' }, settings: {} })
    await manager.install(id)
    expect(() => manager.setLaunch(id, '/etc/hosts', '')).toThrow(/inside the server folder/)
    expect(() => manager.setLaunch(id, join(installDir, '..', 'escape'), '')).toThrow(/inside the server folder/)
    expect(() => manager.setLaunch(id, join(installDir, 'missing.exe'), '')).toThrow(/does not exist/)
  })

  it('lets a catalog game without this OS run with a chosen program', async () => {
    const { manager } = setup('linux')
    const { id } = manager.create({ gameId: 'scum', name: 'Scum', settings: {} })
    await manager.install(id)
    expect(manager.get(id)).toMatchObject({ status: 'stopped', needsLaunchSetup: true })
  })

  it('builds a definition to share that passes the catalog checks', async () => {
    const { manager } = setup()
    const { id, installDir } = manager.create({ gameId: 'custom', name: 'My Server', custom: { appId: 999999, name: 'Some Game' }, ports: { game: 27016 }, settings: {} })
    await manager.install(id)
    mkdirSync(join(installDir, 'bin'), { recursive: true })
    writeFileSync(join(installDir, 'bin', 'srv'), '')
    manager.setLaunch(id, join(installDir, 'bin', 'srv'), '-port {port:game}')
    const def = manager.shareDefinition(id)
    expect(def).toMatchObject({
      id: 'some-game',
      name: 'Some Game',
      serverAppId: 999999,
      tier: 'basic',
      platforms: { linux: { executable: 'bin/srv', args: ['-port', '{port:game}'] } },
      ports: [{ name: 'game', default: 27016, protocol: 'udp' }]
    })
    expect(validateDefinition('some-game.json', def)).toBeNull()
  })

  const rust = { gameId: 'rust', name: 'Wasteland', settings: { serverName: 'Wasteland' } }

  it('installs a mod loader only while the server is stopped', async () => {
    const { manager } = setup()
    const { id } = manager.create(rust)
    await expect(manager.installLoader(id, 'oxide')).rejects.toThrow(/Install the server first/)
    await manager.install(id)
    await manager.start(id)
    await expect(manager.installLoader(id, 'oxide')).rejects.toThrow(/Stop the server/)
    await manager.stop(id)
    await manager.installLoader(id, 'oxide')
    expect(manager.get(id).loaders).toEqual([expect.objectContaining({ id: 'oxide', installed: true })])
  })

  it('puts Oxide back after an update, because the update overwrites it', async () => {
    const { manager, log } = setup()
    const { id } = manager.create(rust)
    await manager.install(id)
    await manager.installLoader(id, 'oxide')
    log.length = 0
    await manager.update(id)
    expect(log).toEqual(['steamcmd validate', 'download Oxide.Rust-linux.zip'])
  })

  it('restores the files a loader replaced when it is removed', async () => {
    const { manager, log } = setup()
    const { id, installDir } = manager.create(rust)
    await manager.install(id)
    mkdirSync(join(installDir, 'RustDedicated_Data/Managed'), { recursive: true })
    writeFileSync(join(installDir, 'RustDedicated_Data/Managed/Assembly-CSharp.dll'), 'vanilla')
    await manager.installLoader(id, 'oxide')
    log.length = 0
    await manager.uninstallLoader(id, 'oxide')
    expect(log).toEqual(['steamcmd validate'])
    expect(manager.get(id).loaders[0].installed).toBe(false)
  })

  it('starts Valheim with the BepInEx environment on Linux', async () => {
    const { manager, processes } = setup('linux')
    const { id, installDir } = manager.create(valheim)
    await manager.install(id)
    await manager.installLoader(id, 'bepinex')
    await manager.start(id)
    expect(processes[0].spec!.env).toMatchObject({
      DOORSTOP_ENABLED: '1',
      DOORSTOP_TARGET_ASSEMBLY: `${installDir}/BepInEx/core/BepInEx.Preloader.dll`,
      LD_PRELOAD: 'libdoorstop_x64.so',
      SteamAppId: '892970'
    })
  })

  it('loads a Workshop map through the console', async () => {
    const { manager, restCalls } = setup()
    const { id } = manager.create({ gameId: 'cs2', name: 'Arena', settings: {} })
    await manager.install(id)
    await manager.start(id)
    await manager.workshop(id, '3070284539')
    expect(restCalls).toEqual(['rcon:host_workshop_map 3070284539'])
    await expect(manager.workshop(id, '1; quit')).rejects.toThrow(/Workshop item id/)
  })
})

describe('Steam account', () => {
  const arma = { gameId: 'arma-3', name: 'Ops', settings: {} }

  it('refuses to install a game that needs an account before sign-in', async () => {
    const { manager } = setup()
    const { id } = manager.create(arma)
    await expect(manager.install(id)).rejects.toThrow(/Sign in to Steam/)
  })

  it('installs it with the signed-in account', async () => {
    const { manager, steamArgs } = setup()
    manager.setSteamAccount('gamer_1')
    const { id } = manager.create(arma)
    await manager.install(id)
    expect(steamArgs[0]).toContain('gamer_1')
    expect(steamArgs[0]).not.toContain('anonymous')
  })

  it('keeps anonymous login for games that do not need an account', async () => {
    const { manager, steamArgs } = setup()
    manager.setSteamAccount('gamer_1')
    const { id } = manager.create(valheim)
    await manager.install(id)
    expect(steamArgs[0]).toContain('anonymous')
  })

  it('remembers only the account name, across restarts', () => {
    const { manager, deps, dataDir } = setup()
    manager.setSteamAccount('gamer_1')
    expect(new ServerManager(deps).steamAccount()).toBe('gamer_1')
    expect(JSON.parse(readFileSync(join(dataDir, 'steam.json'), 'utf8'))).toEqual({ user: 'gamer_1' })
    manager.setSteamAccount(null)
    expect(new ServerManager(deps).steamAccount()).toBeNull()
  })

  it('rejects names SteamCMD could misread', () => {
    const { manager } = setup()
    expect(() => manager.setSteamAccount('+quit')).toThrow(/Steam account name/)
  })

  it('asks SteamCMD whether the saved login still works', async () => {
    const { manager } = setup('linux', { appInfo: "Logging in user 'gamer_1' to Steam Public...OK\nWaiting for user info...OK" })
    expect(await manager.steamSignedIn()).toBe(false)
    manager.setSteamAccount('gamer_1')
    expect(await manager.steamSignedIn()).toBe(true)
  })
})
