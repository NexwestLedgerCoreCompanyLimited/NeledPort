import { existsSync, statfsSync } from 'node:fs'
import os from 'node:os'
import type { ServerManager } from './manager'
import type { GameDefinition, PlayerInfo, ServerView } from './types'

/**
 * The one door into a running NeledPort for everything that is not its own window: the CLI, the MCP server and other
 * machines. Each caller has a role; view < control < owner. Owner is this machine only (the transports make sure).
 */
export type Role = 'view' | 'control' | 'owner'
export interface Caller {
  role: Role
  /** The paired device's name; none for this machine's owner. */
  device?: string
  address?: string
}
export type ApiManager = Pick<
  ServerManager,
  'list' | 'get' | 'lines' | 'players' | 'bans' | 'start' | 'stop' | 'restart' | 'update' | 'backup' | 'command' | 'kick' | 'ban' | 'unban' | 'create' | 'install' | 'remove'
>
export interface AuditEntry {
  time: string
  device: string
  address?: string
  method: string
  server?: string
  ok: boolean
  error?: string
}
export interface ApiContext {
  manager: ApiManager
  games: () => GameDefinition[]
  /** Where servers are installed: its disk is the one the machine status reports. */
  serversDir: string
  version: string
  audit?: (entry: AuditEntry) => void
  /** Methods the host adds for the owner only (devices, remote access, activity). */
  owner?: Record<string, (params: Record<string, unknown>) => unknown>
}
export type Api = (caller: Caller, method: string, params: unknown) => Promise<unknown>

const RANK: Record<Role, number> = { view: 0, control: 1, owner: 2 }

type Params = Record<string, unknown>
const invalid = (message: string) => new Error(message)
const serverId = (p: Params): string => {
  if (typeof p.id !== 'string' || !/^[0-9a-f]{8}$/.test(p.id)) throw invalid('Invalid server id')
  return p.id
}
const text = (v: unknown, max: number, what: string): string => {
  if (typeof v !== 'string' || v.length > max || /[\r\n\0]/.test(v)) throw invalid(`Invalid ${what}`)
  return v
}
const optionalText = (v: unknown, max: number, what: string) => (v === undefined ? undefined : text(v, max, what))
function player(v: unknown): PlayerInfo {
  const p = v as Params
  if (typeof p?.id !== 'string' || typeof p.name !== 'string' || p.id.length > 200 || p.name.length > 200) throw invalid('Invalid player')
  return { id: p.id, name: p.name }
}
function settings(v: unknown): Record<string, string> {
  if (v === undefined) return {}
  if (typeof v !== 'object' || v === null || !Object.values(v).every((x) => typeof x === 'string' && x.length <= 500)) throw invalid('Invalid settings')
  return v as Record<string, string>
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([promise.catch(() => undefined), new Promise<undefined>((r) => setTimeout(() => r(undefined), ms).unref?.())])
}

/** What another machine may see of a server: no settings (passwords), folders or launch line. */
function summary(s: ServerView, players?: number) {
  return {
    id: s.id,
    name: s.name,
    gameId: s.gameId,
    gameName: s.gameName,
    status: s.status,
    progress: s.progress,
    message: s.message,
    ports: s.ports,
    admin: s.admin,
    updateAvailable: s.build.updateAvailable,
    needsLaunchSetup: s.needsLaunchSetup,
    players
  }
}
export type ServerSummary = ReturnType<typeof summary>

// Sandboxes may refuse it; the rest of the status is still worth showing.
function uptime(): number | undefined {
  try {
    return Math.round(os.uptime())
  } catch {
    return undefined
  }
}

async function cpuPercent(): Promise<number> {
  const total = () => os.cpus().reduce((a, c) => ({ idle: a.idle + c.times.idle, all: a.all + Object.values(c.times).reduce((x, y) => x + y, 0) }), { idle: 0, all: 0 })
  const a = total()
  await new Promise((r) => setTimeout(r, 200))
  const b = total()
  const all = b.all - a.all
  return all > 0 ? Math.round((1 - (b.idle - a.idle) / all) * 100) : 0
}

export function createApi(ctx: ApiContext): Api {
  const m = ctx.manager
  const running = (s: ServerView) => s.status === 'running' || s.status === 'starting'
  const methods: Record<string, { role: Role; run: (p: Params) => unknown }> = {
    'machine.status': {
      role: 'view',
      run: async () => {
        const servers = m.list()
        const fs = statfsSync(existsSync(ctx.serversDir) ? ctx.serversDir : os.homedir())
        return {
          hostname: os.hostname(),
          platform: os.platform(),
          release: os.release(),
          uptimeSeconds: uptime(),
          version: ctx.version,
          cpu: { cores: os.cpus().length, percent: await cpuPercent() },
          memory: { total: os.totalmem(), free: os.freemem() },
          disk: { total: fs.blocks * fs.bsize, free: fs.bavail * fs.bsize },
          servers: { total: servers.length, running: servers.filter(running).length }
        }
      }
    },
    'servers.list': {
      role: 'view',
      run: () =>
        Promise.all(
          m.list().map(async (s) => summary(s, running(s) && s.admin.players ? (await withTimeout(m.players(s.id), 3000))?.length : undefined))
        )
    },
    'servers.get': { role: 'view', run: (p) => summary(m.get(serverId(p))) },
    'servers.players': { role: 'view', run: (p) => m.players(serverId(p)) },
    'servers.bans': { role: 'view', run: (p) => m.bans(serverId(p)) },
    'games.list': {
      role: 'view',
      run: () => ctx.games().map((g) => ({ id: g.id, name: g.name, tier: g.tier, serverAppId: g.serverAppId, needsSteamAccount: !g.anonymous }))
    },

    'servers.start': { role: 'control', run: (p) => m.start(serverId(p)) },
    'servers.stop': { role: 'control', run: (p) => m.stop(serverId(p)) },
    'servers.restart': { role: 'control', run: (p) => m.restart(serverId(p)) },
    'servers.update': { role: 'control', run: (p) => m.update(serverId(p)) },
    'servers.backup': { role: 'control', run: (p) => m.backup(serverId(p), 'manual') },
    // Console lines are control only: some games print their admin password there (ARK's command line).
    'servers.lines': {
      role: 'control',
      run: (p) => {
        const last = p.last === undefined ? 200 : Number(p.last)
        if (!Number.isInteger(last) || last < 1 || last > 2000) throw invalid('Invalid line count')
        return m.lines(serverId(p)).slice(-last)
      }
    },
    'servers.command': {
      role: 'control',
      run: (p) => {
        const id = serverId(p)
        if (typeof p.command !== 'string' || !p.command.trim() || p.command.length > 500 || /[\r\n\0]/.test(p.command)) {
          throw invalid('A console command is one line of up to 500 characters')
        }
        return m.command(id, p.command)
      }
    },
    'servers.kick': { role: 'control', run: (p) => m.kick(serverId(p), player(p.player), optionalText(p.reason, 200, 'reason')) },
    'servers.ban': { role: 'control', run: (p) => m.ban(serverId(p), player(p.player), optionalText(p.reason, 200, 'reason')) },
    'servers.unban': { role: 'control', run: (p) => m.unban(serverId(p), text(p.banId, 200, 'ban id')) },

    // Only catalog games in the default folder: a custom App ID or folder is chosen in the app itself.
    'servers.create': {
      role: 'owner',
      run: (p) => {
        const gameId = text(p.gameId, 80, 'game')
        if (!ctx.games().some((g) => g.id === gameId)) throw invalid(`Unknown game: ${gameId}`)
        return summary(m.create({ gameId, name: text(p.name, 80, 'name'), settings: settings(p.settings) }))
      }
    },
    'servers.install': { role: 'owner', run: (p) => m.install(serverId(p)) },
    'servers.remove': { role: 'owner', run: (p) => m.remove(serverId(p)) },
    ...Object.fromEntries(Object.entries(ctx.owner ?? {}).map(([name, run]) => [name, { role: 'owner' as Role, run }]))
  }

  return async (caller, method, params) => {
    const entry = Object.hasOwn(methods, method) ? methods[method] : undefined
    if (!entry) throw invalid(`Unknown method: ${method}`)
    const p = (typeof params === 'object' && params !== null ? params : {}) as Params
    const log = (ok: boolean, error?: string) =>
      ctx.audit?.({
        time: new Date().toISOString(),
        device: caller.device ?? 'this machine',
        address: caller.address,
        method,
        server: typeof p.id === 'string' ? p.id.slice(0, 16) : undefined,
        ok,
        error
      })
    if (RANK[caller.role] < RANK[entry.role]) {
      const error = `${method} is not allowed for a ${caller.role} device`
      log(false, error)
      throw new Error(error)
    }
    if (entry.role === 'view') return entry.run(p)
    try {
      const result = await entry.run(p)
      log(true)
      return result
    } catch (e) {
      log(false, (e as Error).message)
      throw e
    }
  }
}
