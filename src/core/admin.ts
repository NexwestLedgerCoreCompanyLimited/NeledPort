import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { queryPlayers } from './a2s'
import { goldsrcRconExec } from './goldsrc'
import { isleRconExec } from './isle'
import { palworldRest } from './palworld'
import { pavlovRconExec } from './pavlov'
import { quakeRconExec } from './quake'
import { rconExec } from './rcon'
import { satisfactoryApi } from './satisfactory'
import { telnetExec } from './telnet'
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
  goldsrc?: Remote
  a2s?: (port: number) => Promise<{ name: string; score: number; seconds: number }[]>
  rest?: (o: { port: number; basePath: string; username: string; password: string }) => {
    players(): Promise<{ players?: { name: string; userId: string; ping?: number }[] }>
    kick(userid: string, message: string): Promise<unknown>
    ban(userid: string, message: string): Promise<unknown>
    unban(userid: string): Promise<unknown>
    announce(message: string): Promise<unknown>
    save(): Promise<unknown>
  }
  satisfactory?: typeof satisfactoryApi
  telnet?: typeof telnetExec
  quake?: Remote
  pavlov?: Remote
  isle?: Remote
}

export interface AdminContext {
  game: GameDefinition
  installDir: string
  ports: Record<string, number>
  adminPassword: string
  tracker?: LogPlayerTracker
  net?: AdminNet
  /** Types a line into the server's own console and resolves with what it prints next (stdin-controlled games). */
  console?: (command: string) => Promise<string>
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
    const groups = this.join?.exec(line)?.groups
    const joined = groups?.id
    if (joined) {
      this.online.set(joined, { id: joined, name: groups.name ?? joined, since: Date.now() })
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

type BanFormat = NonNullable<GameDefinition['bans']>['format']

/** One ban-list line as the game writes it, or nothing for comments and other lines. */
function banLine(line: string, format: BanFormat = 'lines'): BanEntry | undefined {
  const l = line.trim()
  if (format === 'source-cfg') {
    const id = /^banid\s+[\d.]+\s+(\S+)/.exec(l)?.[1]
    return id ? { id } : undefined
  }
  if (format === 'rust-cfg') {
    const m = /^banid\s+(\d+)\s+"([^"]*)"\s+"([^"]*)"/.exec(l)
    return m ? { id: m[1], name: m[2], reason: m[3] } : undefined
  }
  if (format === 'listip') {
    // Quake-engine listip.cfg as Warfork's writeip leaves it: "ban <steamid64> [minutes]".
    const id = /^ban\s+(\d{17})\b/.exec(l)?.[1]
    return id ? { id } : undefined
  }
  if (format === 'squad-cfg') {
    // "<id>:<unban time> //reason", or the same after "Admin [SteamID x] Banned:" when the server wrote it.
    const m = /(?:^|Banned:)(\d{17}):\d+(?:\s*\/\/\s*(.*))?$/.exec(l)
    return m ? { id: m[1], ...(m[2] ? { reason: m[2] } : {}) } : undefined
  }
  return l && !l.startsWith('//') ? { id: l } : undefined
}

function readBans(file: string | undefined, format?: BanFormat): BanEntry[] {
  if (!file || !existsSync(file)) return []
  return readFileSync(file, 'utf8').split(/\r?\n/).flatMap((l) => banLine(l, format) ?? [])
}

/** Takes a player's lines out of a ban list the game reads (Squad's Bans.cfg has no unban command). */
function removeBan(file: string, format: BanFormat, id: string): void {
  if (!existsSync(file)) return
  const kept = readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l !== '' && banLine(l, format)?.id !== id)
  writeFileSync(file, kept.length ? kept.join('\n') + '\n' : '')
}

function writeLineBan(file: string, id: string, add: boolean): void {
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l !== '') : []
  const kept = lines.filter((l) => l.trim() !== id)
  if (add) kept.push(id)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, kept.length ? kept.join('\n') + '\n' : '')
}

/** Player rows of a Source engine `status` (# userid [slot] "name" uniqueid connected ping loss state ...). Bots have no time. */
function parseSourceStatus(text: string): (PlayerInfo & { userid: number })[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const m = /^#\s*(\d+)\s+(?:\d+\s+)?"(.*)"\s+(\S+)\s+(\d+(?::\d+){1,2})\s+(\d+)\s/.exec(line)
    if (!m) return []
    const seconds = m[4].split(':').reduce((total, part) => total * 60 + Number(part), 0)
    return [{ userid: Number(m[1]), id: m[3], name: m[2], ping: Number(m[5]), seconds }]
  })
}

/** GoldSrc status: # slot "name" userid uniqueid frag time ping loss adr. Bots and HLTV have no SteamID. */
function parseGoldsrcStatus(text: string): (PlayerInfo & { userid: number })[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const m = /^#\s*\d+\s+"(.*)"\s+(\d+)\s+(\S+)\s+-?\d+\s+(\d+(?::\d+){1,2})\s+(\d+)\s+\d+/.exec(line)
    if (!m || !m[3].startsWith('STEAM_')) return []
    const seconds = m[4].split(':').reduce((total, part) => total * 60 + Number(part), 0)
    return [{ userid: Number(m[2]), id: m[3], name: m[1], ping: Number(m[5]), seconds }]
  })
}

/** Steam account number from STEAM_X:Y:Z, [U:1:N] or SteamID64; anything else is refused (IDs go into commands unquoted). */
function accountId(id: string): bigint {
  const text = id.trim()
  const legacy = /^STEAM_[0-5]:([01]):(\d{1,10})$/.exec(text)
  if (legacy) return BigInt(legacy[2]) * 2n + BigInt(legacy[1])
  const id3 = /^\[U:1:(\d{1,10})\]$/.exec(text)
  if (id3) return BigInt(id3[1])
  if (/^7656119\d{10}$/.test(text)) return BigInt(text) - 76561197960265728n
  throw new Error(`"${id}" is not a SteamID (use STEAM_0:1:123, [U:1:123] or a 7656119… number)`)
}

/** GoldSrc only knows STEAM_0:Y:Z. */
const steamId2 = (id: string) => {
  const account = accountId(id)
  return `STEAM_0:${account % 2n}:${account / 2n}`
}

/**
 * A SteamID as Source stores bans: [U:1:N]. Real servers refuse a quoted ID in banid and write every ban in this form,
 * so the ID is sent unquoted and must be nothing but a SteamID. Accepts STEAM_X:Y:Z, [U:1:N] and SteamID64.
 */
const steamId3 = (id: string) => `[U:1:${accountId(id)}]`

// IDs go into commands unquoted, so only characters a player ID can have (SteamID64, STEAM_, [U:1:], EOS ids).
// Names can be anything, so a template puts {name} inside quotes and the quotes are taken out of the name.
function fill(template: string, p: { id: string; name?: string }, reason = ''): string {
  if (template.includes('{id}') && !/^[A-Za-z0-9_:\-[\].]{1,64}$/.test(p.id)) throw new Error(`"${p.id}" is not a valid player ID`)
  return template.replaceAll('{id}', p.id).replaceAll('{name}', q(p.name ?? p.id)).replaceAll('{reason}', q(reason))
}

/** Commands and player-row pattern named by the definition (games that speak RCON their own way, like ARK or Squad). */
function fromDefinition(game: GameDefinition, remote: (cmd: string) => Promise<string>, file: string | undefined, admin: Admin): void {
  const players = game.players
  if (players?.command && players.pattern) {
    const { command, pattern } = players
    admin.players = async () =>
      [...(await remote(command)).matchAll(new RegExp(pattern, 'gm'))].map(({ groups = {} }) => ({
        id: groups.id ?? groups.name,
        name: groups.name ?? groups.id,
        ...(groups.ping ? { ping: Number(groups.ping) } : {}),
        ...(groups.seconds ? { seconds: Number(groups.seconds) } : {})
      }))
  }
  if (players?.kick) {
    const kick = players.kick
    admin.kick = async (p, reason) => void (await remote(fill(kick, p, reason)))
  }
  const bans = game.bans
  if (bans?.ban && (bans.unban || file)) {
    const { ban, unban, save } = bans
    admin.ban = async (p, reason) => {
      await remote(fill(ban, p, reason))
      if (save) await remote(save)
    }
    admin.unban = async (id) => {
      if (unban) await remote(fill(unban, { id }))
      else if (file) removeBan(file, bans.format, id)
      if (save) await remote(save)
    }
    admin.bans = async () => readBans(file, bans.format)
  }
}

export function adminFor(ctx: AdminContext): Admin {
  const { game, installDir, ports, adminPassword } = ctx
  const net = {
    rcon: ctx.net?.rcon ?? rconExec,
    webrcon: ctx.net?.webrcon ?? webRconExec,
    goldsrc: ctx.net?.goldsrc ?? goldsrcRconExec,
    a2s: ctx.net?.a2s ?? ((port: number) => queryPlayers(port)),
    rest: ctx.net?.rest ?? palworldRest,
    satisfactory: ctx.net?.satisfactory ?? satisfactoryApi,
    telnet: ctx.net?.telnet ?? telnetExec,
    quake: ctx.net?.quake ?? quakeRconExec,
    pavlov: ctx.net?.pavlov ?? pavlovRconExec,
    isle: ctx.net?.isle ?? isleRconExec
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
        : control?.type === 'goldsrc' && remotePort
          ? (cmd) => net.goldsrc({ port: remotePort, password: adminPassword }, cmd)
          : control?.type === 'isle' && remotePort
            ? (cmd) => net.isle({ port: remotePort, password: adminPassword }, cmd)
            : control?.type === 'pavlov' && remotePort
            ? (cmd) => net.pavlov({ port: remotePort, password: adminPassword }, cmd)
            : control?.type === 'quake' && remotePort
            ? (cmd) => net.quake({ port: remotePort, password: adminPassword }, cmd)
            : control?.type === 'telnet' && remotePort
            ? (cmd) => net.telnet({ port: remotePort }, cmd)
            : control?.type === 'satisfactory' && remotePort
            ? (cmd) => net.satisfactory({ port: remotePort, password: adminPassword || undefined }).command(cmd)
            : control?.type === 'stdin'
              ? ctx.console
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
    // Source and GoldSrc: status rows carry the SteamID that bans need and the userid that kicks use.
    const goldsrc = control?.type === 'goldsrc'
    const sourceIds = (control?.type === 'rcon' || goldsrc) && game.players?.source === 'rcon'
    const statusRows = async () => (goldsrc ? parseGoldsrcStatus : parseSourceStatus)(await remote('status'))
    if (sourceIds) admin.players = async () => (await statusRows()).map(({ userid: _, ...p }) => p)
    if (game.players?.source === 'rcon' && control?.type === 'webrcon') {
      admin.players = async () =>
        (JSON.parse((await remote('playerlist')) || '[]') as { SteamID: string; DisplayName: string; Ping: number; ConnectedSeconds: number }[]).map((p) => ({
          id: String(p.SteamID),
          name: p.DisplayName,
          ping: p.Ping,
          seconds: p.ConnectedSeconds
        }))
    }
    if (control?.type === 'webrcon') admin.kick = async (p, reason) => void (await remote(`kick "${q(p.id)}" "${q(reason)}"`))
    // kickid with the userid from status: the standard form, with no SteamID parsing involved.
    if (sourceIds) {
      admin.kick = async (p, reason) => {
        const row = (await statusRows()).find((r) => r.id === p.id)
        if (!row) throw new Error(`${p.name} is not on the server any more`)
        await remote(`${goldsrc ? `kick #${row.userid}` : `kickid ${row.userid}`}${reason ? ` "${q(reason)}"` : ''}`)
      }
    }
    if (game.bans?.method === 'rcon' && (control?.type === 'rcon' || goldsrc)) {
      const steamId = goldsrc ? steamId2 : steamId3
      admin.ban = async (p) => {
        await remote(`banid 0 ${steamId(p.id)} kick`)
        await remote('writeid')
      }
      admin.unban = async (id) => {
        await remote(`removeid ${steamId(id)}`)
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

  if (remote) fromDefinition(game, remote, file, admin)

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
