import { randomBytes, randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createBackup, listBackups, pruneBackups, type BackupInfo, type BackupReason } from './backup'
import { palworldRest, prepareConfig } from './palworld'
import { isPortFree } from './ports'
import { ServerProcess, type LaunchSpec, type ProcessState } from './process'
import { appUpdateArgs, ensureSteamCmd, parseSteamCmdLine, runSteamCmd } from './steamcmd'
import { loadServers, saveServers, type ServerConfig } from './store'
import { expand } from './template'
import type { GameDefinition, Platform } from './types'

export type ServerStatus = 'not-installed' | 'installing' | 'updating' | ProcessState

export interface ServerView {
  id: string
  name: string
  gameId: string
  gameName: string
  installDir: string
  ports: Record<string, number>
  settings: Record<string, string>
  status: ServerStatus
  progress?: number
  message?: string
  /** False where NeledPort cannot ask the server to save before stopping (signal-only games on Windows). */
  gracefulStop: boolean
}

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
    run(exe: string, args: string[], onLine: (line: string) => void): Promise<{ ok: boolean; error?: string }>
  }
  createProcess?: (o: { logFile: string; readyPattern?: RegExp }) => ProcessLike
  portFree?: (port: number, protocol: 'udp' | 'tcp') => Promise<boolean>
  rest?: (o: { port: number; basePath: string; username: string; password: string }) => {
    save(): Promise<unknown>
    shutdown(waitSeconds: number, message: string): Promise<unknown>
  }
}

export interface CreateInput {
  gameId: string
  name: string
  installDir?: string
  ports?: Record<string, number>
  settings: Record<string, string>
}

interface Runtime {
  status?: 'installing' | 'updating'
  progress?: number
  message?: string
  proc?: ProcessLike
  lines: string[]
}

const STOP_TIMEOUT_MS = 60_000
const KEEP_BACKUPS = 10
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
  }

  private get storeFile(): string {
    return join(this.deps.dataDir, 'servers.json')
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

  create(input: CreateInput): ServerView {
    const game = this.deps.games().find((g) => g.id === input.gameId)
    if (!game) throw new Error(`Unknown game "${input.gameId}"`)
    if (!game.platforms[this.deps.platform]) throw new Error(`${game.name} has no ${this.deps.platform} server`)
    const name = input.name.trim()
    if (!name || name.length > 64) throw new Error('Server name must be 1–64 characters')

    const settings: Record<string, string> = {}
    const secrets: Record<string, string> = {}
    for (const s of game.settings ?? []) {
      const value = (input.settings[s.key] ?? (s.default !== undefined ? String(s.default) : '')).trim()
      if (s.minLength && value.length < s.minLength) throw new Error(`${s.label} must be at least ${s.minLength} characters`)
      if (s.type === 'number' && !/^\d+$/.test(value)) throw new Error(`${s.label} must be a whole number`)
      if (s.secret) secrets[s.key] = this.deps.secrets.encrypt(value)
      else settings[s.key] = value
    }
    if (game.control?.type === 'rest') {
      secrets[ADMIN_SECRET] = this.deps.secrets.encrypt(randomBytes(18).toString('base64url'))
    }

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
      createdAt: new Date().toISOString()
    }
    this.servers.push(server)
    this.persist()
    return this.changed(id)
  }

  /** Removes the server from NeledPort. Its files stay on disk. */
  remove(id: string): void {
    if (this.rt(id).proc) throw new Error('Stop the server before removing it')
    this.servers = this.servers.filter((s) => s.id !== id)
    this.runtime.delete(id)
    this.persist()
  }

  async install(id: string, validate = false): Promise<void> {
    const server = this.config(id)
    const game = this.game(server)
    const rt = this.rt(id)
    rt.status ??= 'installing'
    rt.progress = 0
    rt.message = undefined
    this.changed(id)
    try {
      const steam = this.deps.steamcmd ?? { ensure: ensureSteamCmd, run: runSteamCmd }
      this.addLine(id, '[NeledPort] Preparing SteamCMD…')
      const exe = await steam.ensure(join(this.deps.dataDir, 'steamcmd'), this.deps.platform)
      const result = await steam.run(exe, appUpdateArgs({ installDir: server.installDir, appId: game.serverAppId, validate }), (line) => {
        this.addLine(id, line)
        const event = parseSteamCmdLine(line)
        if (event?.kind === 'progress') {
          rt.progress = event.percent
          this.changed(id)
        }
      })
      if (!result.ok) throw new Error(result.error ?? 'SteamCMD failed')
      rt.message = undefined
    } catch (e) {
      rt.message = (e as Error).message
      throw e
    } finally {
      if (rt.status === 'installing') rt.status = undefined
      rt.progress = undefined
      this.changed(id)
    }
  }

  async start(id: string): Promise<void> {
    const server = this.config(id)
    const game = this.game(server)
    const rt = this.rt(id)
    if (rt.proc) throw new Error('Server is already running')
    if (!this.isInstalled(server)) throw new Error('Install the server first')

    const portFree = this.deps.portFree ?? isPortFree
    for (const p of game.ports) {
      const port = server.ports[p.name]
      if (!(await portFree(port, p.protocol))) throw new Error(`Port ${port}/${p.protocol} is already in use`)
    }

    const secrets = this.plainSecrets(server)
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

    const make = this.deps.createProcess ?? ((o) => new ServerProcess({ ...o, maxLines: MAX_LINES }))
    const proc = make({
      logFile: join(this.deps.dataDir, 'logs', id, 'server.log'),
      readyPattern: game.logPatterns?.ready ? new RegExp(game.logPatterns.ready) : undefined
    })
    proc.on('line', (line: string) => this.addLine(id, line))
    proc.on('state', (state: ProcessState) => {
      if (state === 'crashed') rt.message = `Server stopped unexpectedly (exit code ${proc.lastExitCode})`
      if (state === 'stopped' || state === 'crashed') rt.proc = undefined
      this.changed(id)
    })
    rt.proc = proc
    rt.message = undefined
    proc.start(buildLaunch(game, this.deps.platform, server, secrets))
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
    } else if (control?.type === 'stdin') {
      graceful = () => proc.write(control.shutdown ?? 'quit')
    } else {
      graceful = () => proc.interrupt()
    }
    return proc.stop({ graceful, timeoutMs: STOP_TIMEOUT_MS })
  }

  async restart(id: string): Promise<void> {
    await this.stop(id)
    await this.start(id)
  }

  /** Stop (the world is saved and consistent), back up, update with validation, start again if it was running. */
  async update(id: string): Promise<void> {
    const rt = this.rt(id)
    const wasRunning = !!rt.proc
    rt.status = 'updating'
    this.changed(id)
    try {
      if (wasRunning) await this.stop(id)
      await this.backup(id, 'update')
      await this.install(id, true)
    } finally {
      rt.status = undefined
      this.changed(id)
    }
    if (wasRunning) await this.start(id)
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

  async stopAll(): Promise<void> {
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
      gracefulStop: !(game.control?.type === 'signal' && this.deps.platform === 'windows')
    }
  }

  private isInstalled(server: ServerConfig): boolean {
    const exe = this.game(server).platforms[this.deps.platform]?.executable
    return !!exe && existsSync(join(server.installDir, exe))
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

export function buildLaunch(
  game: GameDefinition,
  platform: Platform,
  server: ServerConfig,
  secrets: Record<string, string>
): LaunchSpec {
  const def = game.platforms[platform]
  if (!def) throw new Error(`${game.name} has no ${platform} server`)
  const ctx = { ports: server.ports, settings: { ...server.settings, ...secrets }, installDir: server.installDir }
  return {
    command: join(server.installDir, def.executable),
    args: def.args.map((a) => expand(a, ctx)),
    cwd: server.installDir,
    env: Object.fromEntries(Object.entries(def.env ?? {}).map(([k, v]) => [k, expand(v, ctx)]))
  }
}
