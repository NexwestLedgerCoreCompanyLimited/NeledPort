import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { queryPlayers } from './a2s'
import { palworldRest } from './palworld'
import { rconExec } from './rcon'
import type { AdminCapabilities, BanEntry, GameDefinition, PlayerInfo } from './types'
import { webRconExec } from './webrcon'

export interface Admin {
  players(): Promise<PlayerInfo[]>
  kick?(player: PlayerInfo, reason: string): Promise<void>
  ban?(player: PlayerInfo, reason: string): Promise<void>
  unban?(id: string): Promise<void>
  bans?(): Promise<BanEntry[]>
  command?(text: string): Promise<string>
}

type Remote = (o: { port: number; password: string }, command: string) => Promise<string>

export interface AdminNet {
  rcon?: Remote
  webrcon?: Remote
  a2s?: (port: number) => Promise<{ name: string; score: number; seconds: number }[]>
  rest?: (o: { port: number; basePath: string; username: string; password: string }) => {
    players(): Promise<{ players?: { name: string; userId: string; ping?: number }[] }>
    kick(userid: string, message: string): Promise<unknown>
    ban(userid: string, message: string): Promise<unknown>
    unban(userid: string): Promise<unknown>
    announce(message: string): Promise<unknown>
    save(): Promise<unknown>
  }
}

export interface AdminContext {
  game: GameDefinition
  installDir: string
  ports: Record<string, number>
  adminPassword: string
  tracker?: LogPlayerTracker
  net?: AdminNet
}

// Values end up inside "quoted" console arguments; a quote or newline would let them run other commands.
const q = (text: string) => text.replace(/["\r\n]/g, '')

/** Follows join/leave lines in the server log to know who is online (for games without a player API). */
export class LogPlayerTracker {
  private online = new Map<string, PlayerInfo & { since: number }>()
  private lastJoined?: string
  private join?: RegExp
  private leave?: RegExp
  private character?: RegExp

  constructor(patterns: GameDefinition['logPatterns'] & object) {
    this.join = patterns.join ? new RegExp(patterns.join) : undefined
    this.leave = patterns.leave ? new RegExp(patterns.leave) : undefined
    this.character = patterns.character ? new RegExp(patterns.character) : undefined
  }

  get enabled(): boolean {
    return !!this.join
  }

  feed(line: string): void {
    const joined = this.join?.exec(line)?.groups?.id
    if (joined) {
      this.online.set(joined, { id: joined, name: joined, since: Date.now() })
      this.lastJoined = joined
      return
    }
    const left = this.leave?.exec(line)?.groups?.id
    if (left) {
      this.online.delete(left)
      return
    }
    const name = this.character?.exec(line)?.groups?.name
    const player = this.lastJoined ? this.online.get(this.lastJoined) : undefined
    if (name && player && player.name === player.id) player.name = name
  }

  reset(): void {
    this.online.clear()
    this.lastJoined = undefined
  }

  players(): PlayerInfo[] {
    const now = Date.now()
    return [...this.online.values()].map(({ id, name, since }) => ({ id, name, seconds: Math.floor((now - since) / 1000) }))
  }
}

function banFile(installDir: string, game: GameDefinition): string | undefined {
  return game.bans?.file ? join(installDir, game.bans.file) : undefined
}

function readBans(file: string | undefined, format: 'lines' | 'rust-cfg' | 'source-cfg' = 'lines'): BanEntry[] {
  if (!file || !existsSync(file)) return []
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim())
  if (format === 'source-cfg') {
    return lines.flatMap((l) => {
      const id = /^banid\s+[\d.]+\s+(\S+)/.exec(l)?.[1]
      return id ? [{ id }] : []
    })
  }
  if (format === 'rust-cfg') {
    return lines.flatMap((l) => {
      const m = /^banid\s+(\d+)\s+"([^"]*)"\s+"([^"]*)"/.exec(l)
      return m ? [{ id: m[1], name: m[2], reason: m[3] }] : []
    })
  }
  return lines.filter((l) => l && !l.startsWith('//')).map((id) => ({ id }))
}

function writeLineBan(file: string, id: string, add: boolean): void {
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l !== '') : []
  const kept = lines.filter((l) => l.trim() !== id)
  if (add) kept.push(id)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, kept.length ? kept.join('\n') + '\n' : '')
}

/** Player rows of a Source engine `status` (# userid [slot] "name" uniqueid connected ping loss state ...). Bots have no time. */
function parseSourceStatus(text: string): PlayerInfo[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const m = /^#\s*\d+\s+(?:\d+\s+)?"(.*)"\s+(\S+)\s+(\d+(?::\d+){1,2})\s+(\d+)\s/.exec(line)
    if (!m) return []
    const seconds = m[3].split(':').reduce((total, part) => total * 60 + Number(part), 0)
    return [{ id: m[2], name: m[1], ping: Number(m[4]), seconds }]
  })
}

export function adminFor(ctx: AdminContext): Admin {
  const { game, installDir, ports, adminPassword } = ctx
  const net = {
    rcon: ctx.net?.rcon ?? rconExec,
    webrcon: ctx.net?.webrcon ?? webRconExec,
    a2s: ctx.net?.a2s ?? ((port: number) => queryPlayers(port)),
    rest: ctx.net?.rest ?? palworldRest
  }
  const file = banFile(installDir, game)
  const admin: Admin = { players: async () => Promise.reject(new Error('A player list is not available for this game yet')) }

  const control = game.control
  const remotePort = control?.port ? ports[control.port] : undefined
  const remote: ((cmd: string) => Promise<string>) | undefined =
    control?.type === 'webrcon' && remotePort
      ? (cmd) => net.webrcon({ port: remotePort, password: adminPassword }, cmd)
      : control?.type === 'rcon' && remotePort
        ? (cmd) => net.rcon({ port: remotePort, password: adminPassword }, cmd)
        : undefined

  if (control?.type === 'rest' && control.rest) {
    const api = net.rest({ port: ports[control.rest.port], basePath: control.rest.basePath, username: control.rest.username, password: adminPassword })
    admin.players = async () =>
      ((await api.players()).players ?? []).map((p) => ({ id: p.userId, name: p.name, ...(p.ping !== undefined ? { ping: Math.round(p.ping) } : {}) }))
    admin.kick = async (p, reason) => void (await api.kick(p.id, reason))
    admin.ban = async (p, reason) => void (await api.ban(p.id, reason))
    admin.unban = async (id) => void (await api.unban(id))
    admin.bans = async () => readBans(file)
    admin.command = async (text) => {
      const say = /^(?:say|announce)\s+(.+)$/i.exec(text.trim())
      if (say) {
        await api.announce(say[1])
        return 'Announced.'
      }
      if (/^save$/i.test(text.trim())) {
        await api.save()
        return 'Saved.'
      }
      throw new Error('Palworld accepts: say <message>, save')
    }
    return admin
  }

  if (remote) {
    admin.command = remote
    // Source engine: status rows carry the SteamID that kickid, banid and removeid need.
    const sourceIds = control?.type === 'rcon' && game.players?.source === 'rcon'
    if (sourceIds) admin.players = async () => parseSourceStatus(await remote('status'))
    if (game.players?.source === 'rcon' && control?.type === 'webrcon') {
      admin.players = async () =>
        (JSON.parse((await remote('playerlist')) || '[]') as { SteamID: string; DisplayName: string; Ping: number; ConnectedSeconds: number }[]).map((p) => ({
          id: String(p.SteamID),
          name: p.DisplayName,
          ping: p.Ping,
          seconds: p.ConnectedSeconds
        }))
    }
    admin.kick = async (p, reason) =>
      void (await remote(
        control?.type === 'webrcon'
          ? `kick "${q(p.id)}" "${q(reason)}"`
          : sourceIds
            ? // A colon in the reason would make the engine read it as part of a STEAM_ id.
              `kickid "${q(p.id)}"${reason ? ` "${q(reason).replace(/:/g, '')}"` : ''}`
            : `kick "${q(p.name)}"`
      ))
    if (game.bans?.method === 'rcon' && control?.type === 'rcon') {
      admin.ban = async (p) => {
        await remote(`banid 0 "${q(p.id)}" kick`)
        await remote('writeid')
      }
      admin.unban = async (id) => {
        await remote(`removeid "${q(id)}"`)
        await remote('writeid')
      }
      admin.bans = async () => readBans(file, game.bans?.format)
    } else if (game.bans?.method === 'rcon') {
      admin.ban = async (p, reason) => {
        await remote(`banid ${q(p.id)} "${q(p.name)}" "${q(reason)}"`)
        await remote('server.writecfg')
      }
      admin.unban = async (id) => {
        await remote(`unban ${q(id)}`)
        await remote('server.writecfg')
      }
      admin.bans = async () => readBans(file, game.bans?.format)
    }
  }

  if (game.players?.source === 'a2s' && game.players.port) {
    const port = ports[game.players.port]
    admin.players = async () => (await net.a2s(port)).map((p) => ({ id: p.name, name: p.name, seconds: p.seconds }))
  }

  if (game.players?.source === 'log' && ctx.tracker?.enabled) {
    const tracker = ctx.tracker
    admin.players = async () => tracker.players()
  }

  if (game.bans?.method === 'file' && file) {
    admin.ban = async (p) => writeLineBan(file, p.id, true)
    admin.unban = async (id) => writeLineBan(file, id, false)
    admin.bans = async () => readBans(file, game.bans?.format)
  }

  return admin
}

export function capabilities(game: GameDefinition, admin: Admin): AdminCapabilities {
  return {
    players: !!game.players,
    kick: !!admin.kick,
    ban: !!admin.ban,
    unban: !!admin.unban,
    command: !!admin.command,
    banOnNextJoin: game.bans?.method === 'file'
  }
}
