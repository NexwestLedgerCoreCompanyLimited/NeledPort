import { randomBytes, randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { splitArgs } from './args'
import { adminFor, capabilities, LogPlayerTracker, type Admin, type AdminNet } from './admin'
import { createBackup, listBackups, pruneBackups, restoreBackup } from './backup'
import { addPlugin, downloadZip, installLoader, listPlugins, loaderState, removePlugin, setPluginEnabled, uninstallLoader } from './mods'
import { appInfoArgs, installedBuild, parseLatestBuild } from './build'
import { palworldRest, prepareConfig } from './palworld'
import { satisfactoryApi } from './satisfactory'
import { telnetExec } from './telnet'
import { writeSourceConfig } from './sourcecfg'
import { writeConfigValues } from './configwrite'
import { isPortFree } from './ports'
import { ServerProcess, type LaunchSpec } from './process'
import { appUpdateArgs, captureSteamCmd, ensureSteamCmd, isSteamUser, parseSignedIn, parseSteamCmdLine, runSteamCmd } from './steamcmd'
import { loadServers, saveServers, type ServerConfig } from './store'
import { expand } from './template'
import { KEEP_BACKUPS } from './types'
import type {
  BackupInfo,
  BackupReason,
  BanEntry,
  BuildInfo,
  CreateServerInput,
  LoaderInfo,
  ModLoaderDefinition,
  PluginInfo,
  GameDefinition,
  Platform,
  PlayerInfo,
  ProcessState,
  ServerStatus,
  ServerView
} from './types'

export interface ProcessLike extends EventEmitter {
  state: ProcessState
  lastExitCode: number | null
  start(spec: LaunchSpec): void
  write(text: string): void
  interrupt(): boolean
  stop(o: { graceful?: () => unknown; timeoutMs: number }): Promise<{ forced: boolean }>
}

export interface ManagerDeps {
  dataDir: string
  serversDir: string
  platform: Platform
  games: () => GameDefinition[]
  secrets: { encrypt(plain: string): string; decrypt(stored: string): string }
  steamcmd?: {
    ensure(dir: string, platform: Platform): Promise<string>
    run(exe: string, args: string[], onLine: (line: string) => void, signal?: AbortSignal): Promise<{ ok: boolean; error?: string }>
    capture?(exe: string, args: string[], timeoutMs?: number): Promise<string>
  }
  createProcess?: (o: { logFile: string; readyPattern?: RegExp; hide?: string[] }) => ProcessLike
  portFree?: (port: number, protocol: 'udp' | 'tcp') => Promise<boolean>
  rest?: (o: { port: number; basePath: string; username: string; password: string }) => {
    save(): Promise<unknown>
    shutdown(waitSeconds: number, message: string): Promise<unknown>
  }
  /** Player/ban/console transports; real network clients when omitted. */
  net?: AdminNet
  /** Mod loader downloads; HTTPS from GitHub/Thunderstore when omitted. */
  download?: (url: string) => Promise<Buffer>
  /** Linux: ~/.steam, where many servers look for steamclient.so. Skipped when omitted. */
  steamSdkDir?: string
}

interface Runtime {
  status?: 'installing' | 'updating'
  progress?: number
  message?: string
  proc?: ProcessLike
  /** Set while install/start/update/restart runs, so a double click cannot run two at once. */
  busy?: boolean
  /** Stops the SteamCMD of a running install when NeledPort quits. */
  install?: AbortController
  lines: string[]
  tracker?: LogPlayerTracker
  latestBuild?: string
  buildError?: string
}

const STOP_TIMEOUT_MS = 60_000
const MAX_LINES = 2000
const ADMIN_SECRET = 'adminPassword'

export class ServerManager extends EventEmitter {
  private servers: ServerConfig[]
  private runtime = new Map<string, Runtime>()
  readonly loadError?: string

  constructor(private deps: ManagerDeps) {
    super()
    const { servers, error } = loadServers(this.storeFile)
    this.servers = servers
    this.loadError = error
    this.addNewDefaults()
  }

  /** Servers made before their game gained a port or setting (moving to full support) get its default, so they still start. */
  private addNewDefaults(): void {
    const games = this.deps.games()
    let changed = false
    for (const server of this.servers) {
      const game = server.custom ? undefined : games.find((g) => g.id === server.gameId)
      for (const p of game?.ports ?? []) {
        if (p.name in server.ports) continue
        server.ports[p.name] = p.default
        changed = true
      }
      for (const s of game?.settings ?? []) {
        const store = s.secret ? server.secrets : server.settings
        if (s.key in store) continue
        const value = s.default !== undefined ? String(s.default) : ''
        store[s.key] = s.secret ? this.deps.secrets.encrypt(value) : value
        changed = true
      }
    }
    if (changed) this.persist()
  }

  private get storeFile(): string {
    return join(this.deps.dataDir, 'servers.json')
  }

  private get steamFile(): string {
    return join(this.deps.dataDir, 'steam.json')
  }

  /** The Steam account for games that need one. Only the name: SteamCMD keeps its own login session. */
  steamAccount(): string | null {
    try {
      const { user } = JSON.parse(readFileSync(this.steamFile, 'utf8'))
      return isSteamUser(user) ? user : null
    } catch {
      return null
    }
  }

  setSteamAccount(user: string | null): void {
    if (user === null) return void rmSync(this.steamFile, { force: true })
    if (!isSteamUser(user)) throw new Error('Invalid Steam account name')
    mkdirSync(this.deps.dataDir, { recursive: true })
    writeFileSync(this.steamFile, JSON.stringify({ user }))
  }

  /** Path to SteamCMD, downloading it first if needed (the sign-in window runs it directly). */
  steamCmd(): Promise<string> {
    return (this.deps.steamcmd?.ensure ?? ensureSteamCmd)(join(this.deps.dataDir, 'steamcmd'), this.deps.platform)
  }

  /** Whether SteamCMD's saved login for the account still works; Steam expires it after a while. */
  async steamSignedIn(): Promise<boolean> {
    const user = this.steamAccount()
    if (!user) return false
    const capture = this.deps.steamcmd?.capture ?? captureSteamCmd
    return parseSignedIn(await capture(await this.steamCmd(), ['+login', user, '+quit'], 90_000))
  }

  list(): ServerView[] {
    return this.servers.map((s) => this.view(s))
  }

  get(id: string): ServerView {
    return this.view(this.config(id))
  }

  lines(id: string): string[] {
    return [...this.rt(id).lines]
  }

  backups(id: string): BackupInfo[] {
    return listBackups(this.backupsDir(id))
  }

  create(input: CreateServerInput): ServerView {
    const custom = input.gameId === 'custom' ? parseCustom(input.custom) : undefined
    const game = custom ? customGame(custom, input.ports) : this.deps.games().find((g) => g.id === input.gameId)
    if (!game) throw new Error(`Unknown game "${input.gameId}"`)
    const name = input.name.trim()
    if (!name || name.length > 64) throw new Error('Server name must be 1–64 characters')

    const { settings, secrets } = this.checkSettings(game, input.settings)
    // One generated password per server for whatever remote control the game uses (REST, RCON, WebRCON).
    secrets[ADMIN_SECRET] = this.deps.secrets.encrypt(randomBytes(18).toString('base64url'))

    const ports = Object.fromEntries(game.ports.map((p) => [p.name, input.ports?.[p.name] ?? p.default]))
    for (const [portName, port] of Object.entries(ports)) {
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Port ${portName} must be 1–65535`)
    }

    const id = randomUUID().slice(0, 8)
    const server: ServerConfig = {
      id,
      name,
      gameId: game.id,
      installDir: input.installDir ?? join(this.deps.serversDir, `${game.id}-${id}`),
      ports,
      settings,
      secrets,
      createdAt: new Date().toISOString(),
      ...(custom ? { custom } : {})
    }
    this.servers.push(server)
    this.persist()
    return this.changed(id)
  }

  /** New settings take effect the next time the server starts. An empty secret keeps the old one. */
  updateSettings(id: string, input: Record<string, string>): ServerView {
    const server = this.config(id)
    const { settings, secrets } = this.checkSettings(this.game(server), input, server)
    server.settings = settings
    server.secrets = { ...server.secrets, ...secrets }
    this.persist()
    return this.changed(id)
  }

  private checkSettings(game: GameDefinition, input: Record<string, string>, current?: ServerConfig) {
    const settings: Record<string, string> = {}
    const secrets: Record<string, string> = {}
    for (const s of game.settings ?? []) {
      const value = (input[s.key] ?? current?.settings[s.key] ?? (s.default !== undefined ? String(s.default) : '')).trim()
      if (s.secret && !value && current?.secrets[s.key]) continue
      if (s.minLength && value.length < s.minLength) throw new Error(`${s.label} must be at least ${s.minLength} characters`)
      if (s.type === 'number' && !/^\d+$/.test(value)) throw new Error(`${s.label} must be a whole number`)
      if (s.secret) secrets[s.key] = this.deps.secrets.encrypt(value)
      else settings[s.key] = value
    }
    return { settings, secrets }
  }

  /** The game's own settings files, as text. A file the game has not written yet reads as empty. */
  configFiles(id: string): { path: string; text: string }[] {
    const server = this.config(id)
    return this.configPaths(server).map((path) => {
      const full = join(server.installDir, path)
      return { path, text: existsSync(full) ? readFileSync(full, 'utf8') : '' }
    })
  }

  /** Only while stopped, because some games rewrite their config when they exit. The previous file is kept as .neledport.bak. */
  saveConfigFile(id: string, path: string, text: string): void {
    const server = this.config(id)
    if (!this.configPaths(server).includes(path)) throw new Error('Unknown config file')
    const rt = this.rt(id)
    if (rt.proc || rt.busy) throw new Error('Stop the server before editing its config files')
    const full = join(server.installDir, path)
    if (existsSync(full)) copyFileSync(full, `${full}.neledport.bak`)
    else mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, text)
  }

  private configPaths(server: ServerConfig): string[] {
    return (this.game(server).platforms[this.deps.platform]?.configFiles ?? []).map((c) => c.path)
  }

  /** Removes the server from NeledPort. Its files stay on disk. */
  remove(id: string): void {
    if (this.rt(id).proc) throw new Error('Stop the server before removing it')
    this.servers = this.servers.filter((s) => s.id !== id)
    this.runtime.delete(id)
    this.persist()
  }

  install(id: string, validate = false): Promise<void> {
    return this.exclusive(id, () => this.installNow(id, validate))
  }

  start(id: string): Promise<void> {
    return this.exclusive(id, () => this.startNow(id))
  }

  restart(id: string): Promise<void> {
    return this.exclusive(id, async () => {
      await this.stop(id)
      await this.startNow(id)
    })
  }

  private async installNow(id: string, validate: boolean): Promise<void> {
    const server = this.config(id)
    const game = this.game(server)
    const rt = this.rt(id)
    rt.status ??= 'installing'
    rt.progress = 0
    rt.message = undefined
    const abort = (rt.install = new AbortController())
    this.changed(id)
    try {
      const login = game.anonymous ? undefined : this.steamAccount()
      if (login === null) throw new Error(`Sign in to Steam first: ${game.name} needs an account that owns it`)
      const steam = this.deps.steamcmd ?? { ensure: ensureSteamCmd, run: runSteamCmd }
      this.addLine(id, '[NeledPort] Preparing SteamCMD…')
      const exe = await steam.ensure(join(this.deps.dataDir, 'steamcmd'), this.deps.platform)
      const branch = game.platforms[this.deps.platform]?.steamBranch
      const args = appUpdateArgs({ installDir: server.installDir, appId: game.serverAppId, validate, login, mod: game.steamMod, branch })
      const onLine = (line: string) => {
        this.addLine(id, line)
        const event = parseSteamCmdLine(line)
        if (event?.kind === 'progress') {
          rt.progress = event.percent
          this.changed(id)
        }
      }
      let result = await steam.run(exe, args, onLine, abort.signal)
      // A SteamCMD that just updated itself can fail its first app_update this way; a second run works.
      if (!result.ok && /\(Missing configuration\)/.test(result.error ?? '')) {
        this.addLine(id, '[NeledPort] SteamCMD was not ready yet, trying again…')
        result = await steam.run(exe, args, onLine, abort.signal)
      }
      if (abort.signal.aborted) throw new Error('Install stopped: NeledPort is closing')
      if (!result.ok) throw new Error(result.error ?? 'SteamCMD failed')
      rt.message = undefined
    } catch (e) {
      rt.message = (e as Error).message
      throw e
    } finally {
      if (rt.status === 'installing') rt.status = undefined
      rt.progress = undefined
      rt.install = undefined
      this.changed(id)
    }
  }

  private async startNow(id: string): Promise<void> {
    const server = this.config(id)
    const game = this.game(server)
    const rt = this.rt(id)
    if (rt.proc) throw new Error('Server is already running')
    if (!this.isInstalled(server)) throw new Error('Install the server first')
    if (this.needsLaunchSetup(server)) throw new Error('Choose the program that starts the server first')

    const portFree = this.deps.portFree ?? isPortFree
    for (const p of game.ports) {
      const port = server.ports[p.name]
      if (!(await portFree(port, p.protocol))) throw new Error(`Port ${port}/${p.protocol} is already in use`)
    }

    const secrets = this.plainSecrets(this.ensureAdminSecret(server))
    this.provideSteamClient(server, game)
    if (game.configAdapter === 'palworld') {
      prepareConfig(server.installDir, this.deps.platform, {
        serverName: server.settings.serverName ?? server.name,
        password: secrets.password ?? '',
        adminPassword: secrets[ADMIN_SECRET],
        maxPlayers: Number(server.settings.maxPlayers ?? 32),
        gamePort: server.ports.game,
        restPort: server.ports.rest
      })
    }
    const ctx = launchContext(server, secrets)
    for (const w of game.platforms[this.deps.platform]?.configWrites ?? []) {
      writeConfigValues(join(server.installDir, w.file), {
        section: w.section,
        style: w.style,
        values: Object.fromEntries(Object.entries(w.set).map(([k, v]) => [k, expand(v, ctx)]))
      })
    }
    const sourceCfg = game.platforms[this.deps.platform]?.configFiles?.[0]?.path
    if (game.configAdapter === 'source' && sourceCfg) {
      writeSourceConfig(join(server.installDir, sourceCfg), { hostname: server.settings.serverName ?? server.name, rconPassword: secrets[ADMIN_SECRET] })
    }

    const make = this.deps.createProcess ?? ((o) => new ServerProcess({ ...o, maxLines: MAX_LINES }))
    const proc = make({
      logFile: join(this.deps.dataDir, 'logs', id, 'server.log'),
      readyPattern: game.logPatterns?.ready ? new RegExp(game.logPatterns.ready) : undefined,
      hide: [secrets[ADMIN_SECRET]]
    })
    rt.tracker = new LogPlayerTracker(game.logPatterns ?? {})
    proc.on('line', (line: string) => {
      rt.tracker?.feed(line)
      this.addLine(id, line)
    })
    proc.on('state', (state: ProcessState) => {
      if (state === 'crashed') rt.message = `Server stopped unexpectedly (exit code ${proc.lastExitCode})`
      if (state === 'stopped' || state === 'crashed') rt.proc = undefined
      this.changed(id)
    })
    rt.proc = proc
    rt.message = undefined
    proc.start(buildLaunch(game, this.deps.platform, server, secrets, this.loaderEnv(server, game)))
    this.changed(id)
  }

  async stop(id: string): Promise<{ forced: boolean }> {
    const server = this.config(id)
    const game = this.game(server)
    const proc = this.rt(id).proc
    if (!proc) return { forced: false }

    if (!this.view(server).gracefulStop) {
      // Nothing can ask this server to save, so keep a copy of the world before it is closed.
      await this.backup(id, 'stop')
      return proc.stop({ timeoutMs: 0 })
    }

    const control = game.control
    let graceful: (() => unknown) | undefined
    if (control?.type === 'rest' && control.rest) {
      const rest = (this.deps.rest ?? palworldRest)({
        port: server.ports[control.rest.port],
        basePath: control.rest.basePath,
        username: control.rest.username,
        password: this.plainSecrets(server)[ADMIN_SECRET]
      })
      graceful = async () => {
        await rest.save()
        await rest.shutdown(1, 'Server is shutting down')
      }
    } else if (control?.type === 'telnet' && control.port) {
      const telnet = this.deps.net?.telnet ?? telnetExec
      const port = server.ports[control.port]
      graceful = async () => {
        try {
          // A save can take minutes on a big world; LinuxGSM allows 120 s for "world is saved".
          if (control.save) await telnet({ port, until: control.saveDone ? new RegExp(control.saveDone, 'i') : undefined, timeoutMs: 120_000 }, control.save)
          await telnet({ port }, control.shutdown ?? 'quit')
        } catch (e) {
          this.addLine(id, `[NeledPort] ${(e as Error).message}; sending Ctrl+C instead`)
          proc.interrupt()
        }
      }
    } else if (control?.type === 'satisfactory' && control.port) {
      const api = (this.deps.net?.satisfactory ?? satisfactoryApi)({ port: server.ports[control.port], password: this.plainSecrets(server)[control.passwordSetting ?? ''] || undefined })
      graceful = async () => {
        try {
          await api.saveAndShutdown()
        } catch (e) {
          this.addLine(id, `[NeledPort] ${(e as Error).message}; sending Ctrl+C instead`)
          proc.interrupt()
        }
      }
    } else if (control?.type === 'stdin') {
      graceful = () => {
        if (control.save) proc.write(control.save)
        proc.write(control.shutdown ?? 'quit')
      }
    } else if (control?.type === 'rcon' || control?.type === 'webrcon' || control?.type === 'goldsrc' || control?.type === 'quake' || control?.type === 'pavlov') {
      const admin = this.admin(server)
      graceful = async () => {
        try {
          if (control.save) await admin.command?.(control.save)
          // No quit command (Conan, Squad): the game stops cleanly on Ctrl+C.
          if (control.shutdown) await admin.command?.(control.shutdown)
          else proc.interrupt()
        } catch (e) {
          // Remote console unreachable: fall back to Ctrl+C where the OS allows it.
          this.addLine(id, `[NeledPort] ${(e as Error).message}; sending Ctrl+C instead`)
          proc.interrupt()
        }
      }
    } else {
      graceful = () => proc.interrupt()
    }
    return proc.stop({ graceful, timeoutMs: STOP_TIMEOUT_MS })
  }

  /** Stop (the world is saved and consistent), back up, update with validation, start again if it was running. */
  update(id: string): Promise<void> {
    return this.exclusive(id, async () => {
      const rt = this.rt(id)
      const wasRunning = !!rt.proc
      rt.status = 'updating'
      this.changed(id)
      try {
        if (wasRunning) await this.stop(id)
        await this.backup(id, 'update')
        await this.installNow(id, true)
        await this.reapplyLoaders(id)
      } finally {
        rt.status = undefined
        this.changed(id)
      }
      if (wasRunning) await this.startNow(id)
    })
  }

  private async exclusive<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const rt = this.rt(id)
    if (rt.busy) throw new Error('The server is still busy with another action')
    rt.busy = true
    try {
      return await fn()
    } finally {
      rt.busy = false
    }
  }

  /** Remembers which program starts the server (for games without a launcher on this OS). */
  setLaunch(id: string, program: string, argsText: string): ServerView {
    const server = this.config(id)
    const rel = relative(resolve(server.installDir), resolve(program))
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('The program must be inside the server folder')
    if (!existsSync(join(server.installDir, rel))) throw new Error('That program does not exist')
    const args = splitArgs(argsText)
    // Fail now, not at start time, if the arguments use a placeholder this server does not have.
    buildLaunch(this.game(server), this.deps.platform, { ...server, launch: { executable: rel, args } }, { [ADMIN_SECRET]: '' })
    server.launch = { executable: rel.split(sep).join('/'), args }
    this.persist()
    return this.changed(id)
  }

  /** A catalog definition built from this server, so the user can contribute it. */
  shareDefinition(id: string): GameDefinition {
    const server = this.config(id)
    const game = this.game(server)
    const platforms = { ...game.platforms }
    if (server.launch) platforms[this.deps.platform] = { executable: server.launch.executable, args: server.launch.args }
    const base = server.custom ? { tier: 'basic' as const } : {}
    return { $schema: './schema.json', ...game, ...base, id: slug(game.name), platforms }
  }

  installLoader(id: string, loaderId: string): Promise<void> {
    return this.exclusive(id, async () => {
      const server = this.config(id)
      if (!this.isInstalled(server)) throw new Error('Install the server first')
      if (this.rt(id).proc) throw new Error('Stop the server before changing mod loaders')
      const loader = this.loader(server, loaderId)
      this.addLine(id, `[NeledPort] Installing ${loader.name}…`)
      await installLoader(server.installDir, loader, this.deps.platform, this.deps.download ?? downloadZip)
      this.addLine(id, `[NeledPort] ${loader.name} installed`)
      this.changed(id)
    })
  }

  uninstallLoader(id: string, loaderId: string): Promise<void> {
    return this.exclusive(id, async () => {
      const server = this.config(id)
      if (this.rt(id).proc) throw new Error('Stop the server before changing mod loaders')
      const loader = this.loader(server, loaderId)
      const { needsValidate } = uninstallLoader(server.installDir, loader.id)
      // The loader overwrote game files: SteamCMD validate puts the originals back.
      if (needsValidate) await this.installNow(id, true)
      this.addLine(id, `[NeledPort] ${loader.name} removed`)
      this.changed(id)
    })
  }

  plugins(id: string, loaderId: string): PluginInfo[] {
    const server = this.config(id)
    return listPlugins(server.installDir, this.loader(server, loaderId))
  }

  setPluginEnabled(id: string, loaderId: string, name: string, enabled: boolean): void {
    const server = this.config(id)
    setPluginEnabled(server.installDir, this.loader(server, loaderId), name, enabled)
  }

  addPlugin(id: string, loaderId: string, file: string): void {
    const server = this.config(id)
    addPlugin(server.installDir, this.loader(server, loaderId), file)
    this.addLine(id, `[NeledPort] Added plugin ${file.split(/[\\/]/).pop()}`)
  }

  removePlugin(id: string, loaderId: string, name: string): void {
    const server = this.config(id)
    removePlugin(server.installDir, this.loader(server, loaderId), name)
    this.addLine(id, `[NeledPort] Removed plugin ${name}`)
  }

  /** Loads a Steam Workshop item on the running server with the game's own console command. */
  async workshop(id: string, itemId: string): Promise<void> {
    const command = this.game(this.config(id)).workshop?.command
    if (!command) throw new Error('This game has no Workshop support in NeledPort yet')
    if (!/^\d{1,20}$/.test(itemId)) throw new Error('A Workshop item id is a number')
    await this.command(id, command.replace('{id}', itemId))
  }

  async players(id: string): Promise<PlayerInfo[]> {
    if (!this.rt(id).proc) throw new Error('Start the server to see who is online')
    return this.admin(this.config(id)).players()
  }

  async kick(id: string, player: PlayerInfo, reason = 'Kicked by an admin'): Promise<void> {
    const kick = this.admin(this.config(id)).kick
    if (!kick) throw new Error('This game cannot kick players')
    await kick(player, reason)
    this.addLine(id, `[NeledPort] Kicked ${player.name}`)
  }

  async ban(id: string, player: PlayerInfo, reason = 'Banned by an admin'): Promise<void> {
    const ban = this.admin(this.config(id)).ban
    if (!ban) throw new Error('This game cannot ban players from NeledPort yet')
    await ban(player, reason)
    this.addLine(id, `[NeledPort] Banned ${player.name}`)
  }

  async unban(id: string, banId: string): Promise<void> {
    const unban = this.admin(this.config(id)).unban
    if (!unban) throw new Error('This game cannot unban players from NeledPort yet')
    await unban(banId)
    this.addLine(id, `[NeledPort] Unbanned ${banId}`)
  }

  async bans(id: string): Promise<BanEntry[]> {
    return (await this.admin(this.config(id)).bans?.()) ?? []
  }

  /** Runs a console command; input and output are echoed to the console. */
  async command(id: string, text: string): Promise<string> {
    const server = this.config(id)
    const rt = this.rt(id)
    if (!rt.proc) throw new Error('Start the server first')
    const cmd = text.trim()
    if (!cmd) return ''
    this.addLine(id, `> ${cmd}`)
    const run = this.admin(server).command
    if (!run) throw new Error('This game has no remote console')
    const output = await run(cmd)
    // A console game's reply is already in the console: it is the server's own output.
    if (this.game(server).control?.type !== 'stdin') for (const line of output.split(/\r?\n/)) if (line) this.addLine(id, line)
    return output
  }

  /** Compares the installed build with the latest build on Steam of the branch the game installs from. */
  async checkBuild(id: string): Promise<BuildInfo> {
    const server = this.config(id)
    const game = this.game(server)
    const rt = this.rt(id)
    try {
      const steam = this.deps.steamcmd ?? { ensure: ensureSteamCmd, run: runSteamCmd, capture: captureSteamCmd }
      const exe = await steam.ensure(join(this.deps.dataDir, 'steamcmd'), this.deps.platform)
      const latest = parseLatestBuild(await (steam.capture ?? captureSteamCmd)(exe, appInfoArgs(game.serverAppId)), game.platforms[this.deps.platform]?.steamBranch)
      if (!latest) throw new Error('Steam did not return build information')
      rt.latestBuild = latest
      rt.buildError = undefined
    } catch (e) {
      rt.buildError = `Could not check for updates: ${(e as Error).message}`
    }
    return this.changed(id).build!
  }

  async backup(id: string, reason: BackupReason = 'manual'): Promise<BackupInfo | null> {
    const server = this.config(id)
    const game = this.game(server)
    if (!game.saveDir) return null
    const info = await createBackup(join(server.installDir, game.saveDir), this.backupsDir(id), reason)
    pruneBackups(this.backupsDir(id), KEEP_BACKUPS)
    if (info) this.addLine(id, `[NeledPort] Backup saved (${reason})`)
    return info
  }

  /** Puts a backup's world back. The current world is moved aside, never deleted. */
  restore(id: string, file: string): Promise<void> {
    return this.exclusive(id, async () => {
      const server = this.config(id)
      const saveDir = this.game(server).saveDir
      if (this.rt(id).proc) throw new Error('Stop the server before restoring a backup')
      const backup = this.backups(id).find((b) => b.file === file)
      if (!backup || !saveDir) throw new Error('Unknown backup')
      await restoreBackup(backup.file, join(server.installDir, saveDir))
      this.addLine(id, `[NeledPort] Restored the backup from ${backup.createdAt}. The previous world is kept next to it.`)
      this.changed(id)
    })
  }

  async stopAll(): Promise<void> {
    for (const rt of this.runtime.values()) rt.install?.abort()
    await Promise.all(this.servers.filter((s) => this.rt(s.id).proc).map((s) => this.stop(s.id)))
  }

  private view(server: ServerConfig): ServerView {
    const game = this.game(server)
    const rt = this.rt(server.id)
    const status: ServerStatus =
      rt.status ?? rt.proc?.state ?? (rt.message?.startsWith('Server stopped unexpectedly') ? 'crashed' : this.isInstalled(server) ? 'stopped' : 'not-installed')
    return {
      id: server.id,
      name: server.name,
      gameId: server.gameId,
      gameName: game.name,
      installDir: server.installDir,
      ports: { ...server.ports },
      settings: { ...server.settings },
      status,
      progress: rt.progress,
      message: rt.message,
      // Windows has no Ctrl+C for a background server: graceful only where the game can be told to quit.
      gracefulStop:
        this.deps.platform !== 'windows' || ['rest', 'satisfactory', 'stdin'].includes(game.control?.type ?? '') || !!game.control?.shutdown,
      admin: capabilities(game, this.admin(server)),
      build: this.buildInfo(server, game, rt),
      needsLaunchSetup: this.needsLaunchSetup(server),
      custom: !!server.custom,
      loaders: (game.modLoaders ?? []).map((l): LoaderInfo => {
        const state = loaderState(server.installDir, l.id)
        return { id: l.id, name: l.name, installed: !!state, ...(state ? { installedAt: state.installedAt } : {}) }
      }),
      workshop: !!game.workshop,
      ...(server.launch ? { launch: server.launch } : {})
    }
  }

  private loader(server: ServerConfig, loaderId: string): ModLoaderDefinition {
    const loader = this.game(server).modLoaders?.find((l) => l.id === loaderId)
    if (!loader) throw new Error(`Unknown mod loader "${loaderId}"`)
    return loader
  }

  private loaderEnv(server: ServerConfig, game: GameDefinition): Record<string, string> {
    return Object.assign(
      {},
      ...(game.modLoaders ?? []).filter((l) => loaderState(server.installDir, l.id)).map((l) => l.env?.[this.deps.platform] ?? {})
    )
  }

  /** Loaders that patch game files are wiped by an update; install their latest build again. */
  private async reapplyLoaders(id: string): Promise<void> {
    const server = this.config(id)
    for (const loader of this.game(server).modLoaders ?? []) {
      if (!loader.reapplyAfterUpdate || !loaderState(server.installDir, loader.id)) continue
      this.addLine(id, `[NeledPort] Reinstalling ${loader.name} after the update…`)
      await installLoader(server.installDir, loader, this.deps.platform, this.deps.download ?? downloadZip)
    }
  }

  private needsLaunchSetup(server: ServerConfig): boolean {
    return !server.launch && !this.game(server).platforms[this.deps.platform]
  }

  private buildInfo(server: ServerConfig, game: GameDefinition, rt: Runtime): BuildInfo {
    const installed = installedBuild(server.installDir, game.serverAppId)
    return {
      installed,
      latest: rt.latestBuild,
      updateAvailable: !!installed && !!rt.latestBuild && installed !== rt.latestBuild,
      error: rt.buildError
    }
  }

  private admin(server: ServerConfig): Admin {
    return adminFor({
      game: this.game(server),
      installDir: server.installDir,
      ports: server.ports,
      adminPassword: this.plainSecrets(server)[this.game(server).control?.passwordSetting ?? ADMIN_SECRET] ?? '',
      tracker: this.rt(server.id).tracker,
      net: this.deps.net,
      console: (command) => this.consoleReply(server.id, command)
    })
  }

  /** Types a line into the server's console and collects what it prints until it goes quiet (no reply after 1 s). */
  private consoleReply(id: string, command: string): Promise<string> {
    const proc = this.rt(id).proc
    if (!proc) return Promise.reject(new Error('Start the server first'))
    return new Promise((resolve) => {
      const lines: string[] = []
      const done = () => {
        this.off('line', onLine)
        clearTimeout(quiet)
        clearTimeout(cap)
        resolve(lines.join('\n'))
      }
      const onLine = (lineId: string, line: string) => {
        if (lineId !== id) return
        lines.push(line)
        clearTimeout(quiet)
        quiet = setTimeout(done, 300)
      }
      let quiet = setTimeout(done, 1000)
      const cap = setTimeout(done, 5000)
      this.on('line', onLine)
      proc.write(command)
    })
  }

  /** Servers created before every server got an admin password receive one on their next start. */
  private ensureAdminSecret(server: ServerConfig): ServerConfig {
    if (!server.secrets[ADMIN_SECRET]) {
      server.secrets[ADMIN_SECRET] = this.deps.secrets.encrypt(randomBytes(18).toString('base64url'))
      this.persist()
    }
    return server
  }

  // Many Linux servers look for ~/.steam/sdk64/steamclient.so; SteamCMD ships it, so copy it there once.
  // Some load it from their own folder instead (LinuxGSM's fix_steamcmd.sh list): refreshed there before every start.
  private provideSteamClient(server: ServerConfig, game: GameDefinition): void {
    for (const { bits, to } of game.platforms[this.deps.platform]?.steamClient ?? []) {
      const src = join(this.deps.dataDir, 'steamcmd', `linux${bits}`, 'steamclient.so')
      if (!existsSync(src)) continue
      mkdirSync(join(server.installDir, to), { recursive: true })
      copyFileSync(src, join(server.installDir, to, 'steamclient.so'))
    }
    const sdk = this.deps.steamSdkDir
    if (this.deps.platform !== 'linux' || !sdk) return
    for (const [from, to] of [['linux64', 'sdk64'], ['linux32', 'sdk32']]) {
      const src = join(this.deps.dataDir, 'steamcmd', from, 'steamclient.so')
      const dest = join(sdk, to, 'steamclient.so')
      if (!existsSync(src) || existsSync(dest)) continue
      try {
        mkdirSync(join(sdk, to), { recursive: true })
        copyFileSync(src, dest)
      } catch {
        // Not fatal: servers that bundle their own steamclient.so still start.
      }
    }
  }

  private isInstalled(server: ServerConfig): boolean {
    const game = this.game(server)
    const exe = server.launch?.executable ?? game.platforms[this.deps.platform]?.executable
    if (exe) return existsSync(join(server.installDir, exe))
    // No known launcher yet: SteamCMD's manifest says whether the files are there.
    return existsSync(join(server.installDir, 'steamapps', `appmanifest_${game.serverAppId}.acf`))
  }

  private plainSecrets(server: ServerConfig): Record<string, string> {
    return Object.fromEntries(Object.entries(server.secrets).map(([k, v]) => [k, this.deps.secrets.decrypt(v)]))
  }

  private config(id: string): ServerConfig {
    const server = this.servers.find((s) => s.id === id)
    if (!server) throw new Error(`Unknown server ${id}`)
    return server
  }

  private game(server: ServerConfig): GameDefinition {
    if (server.custom) return customGame(server.custom, server.ports)
    const game = this.deps.games().find((g) => g.id === server.gameId)
    if (!game) throw new Error(`The game definition "${server.gameId}" is missing`)
    return game
  }

  private rt(id: string): Runtime {
    let rt = this.runtime.get(id)
    if (!rt) this.runtime.set(id, (rt = { lines: [] }))
    return rt
  }

  private backupsDir(id: string): string {
    return join(this.deps.dataDir, 'backups', id)
  }

  private addLine(id: string, line: string): void {
    const lines = this.rt(id).lines
    lines.push(line)
    if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES)
    this.emit('line', id, line)
  }

  private persist(): void {
    saveServers(this.storeFile, this.servers)
  }

  private changed(id: string): ServerView {
    const view = this.get(id)
    this.emit('changed', view)
    return view
  }
}

function launchContext(server: ServerConfig, secrets: Record<string, string>) {
  return { ports: server.ports, settings: { ...server.settings, ...secrets }, installDir: server.installDir, adminPassword: secrets[ADMIN_SECRET] }
}

export function buildLaunch(
  game: GameDefinition,
  platform: Platform,
  server: ServerConfig,
  secrets: Record<string, string>,
  extraEnv: Record<string, string> = {}
): LaunchSpec {
  const def: { executable: string; args: string[]; env?: Record<string, string> } | undefined =
    server.launch ?? game.platforms[platform]
  if (!def) throw new Error(`${game.name} has no ${platform} server`)
  const ctx = launchContext(server, secrets)
  const env = def.env ?? {}
  const command = join(server.installDir, def.executable)
  const args = def.args.map((a) => expand(a, ctx))
  // Unity servers built with graphics (Core Keeper) need an X display: a virtual one, as LinuxGSM does.
  const display = platform === 'linux' && game.platforms.linux?.virtualDisplay
  return {
    command: display ? 'xvfb-run' : command,
    args: display ? ['-a', command, ...args] : args,
    cwd: server.installDir,
    env: Object.fromEntries(Object.entries({ ...env, ...extraEnv }).map(([k, v]) => [k, expand(v, ctx)]))
  }
}

function parseCustom(v: CreateServerInput['custom']): { appId: number; name: string } {
  const name = v?.name?.trim() ?? ''
  if (!v || !Number.isInteger(v.appId) || v.appId < 1) throw new Error('Enter a valid SteamCMD App ID')
  if (!name || name.length > 80) throw new Error('Game name must be 1–80 characters')
  return { appId: v.appId, name }
}

/** A minimal definition for a bare App ID: install with SteamCMD, the user picks the program. */
function customGame(custom: { appId: number; name: string }, ports?: Record<string, number>): GameDefinition {
  return {
    id: `custom-${custom.appId}`,
    name: custom.name,
    serverAppId: custom.appId,
    anonymous: true,
    tier: 'custom',
    platforms: {},
    ports: [{ name: 'game', default: ports?.game ?? 27015, protocol: 'udp' }],
    control: { type: 'signal' }
  }
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
