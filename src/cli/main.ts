import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { version } from '../../package.json'
import type { AuditEntry, ServerSummary } from '../core/api'
import { parseCode, type Device } from '../core/devices'
import { connectLocal, type RemoteStatus } from '../core/host'
import { callApi, parseAddress, type Target } from '../core/remote'

export interface Io {
  out(text: string): void
  err(text: string): void
}
type Env = Record<string, string | undefined>

const COMMANDS = [
  'serve', 'status', 'list', 'games', 'create', 'install', 'start', 'stop', 'restart', 'update', 'backup', 'remove',
  'players', 'bans', 'cmd', 'logs', 'devices', 'remote', 'activity', 'steam-login', 'mcp', 'help', 'version'
]

const HELP = `NeledPort ${version}: host Steam dedicated game servers, with or without a screen.

  neledport serve                      host game servers on this machine (Ctrl+C saves and stops them)
  neledport status | list              this machine and its servers
  neledport games [search]             games NeledPort can host
  neledport create <game> <name> [--set key=value]...
  neledport install|start|stop|restart|update|backup|remove <server>
  neledport players|bans <server>      who is online, who is banned
  neledport cmd <server> <command...>  run a command on the game's console
  neledport logs <server> [--lines N]  latest console lines
  neledport steam-login <user>         sign in to Steam once, for games that need an account

  Remote access (off until you turn it on):
  neledport remote [on|off] [--port 47800] [--host 0.0.0.0]
  neledport devices [list] | devices add <name> [--role view|control] | devices revoke <id>
  neledport activity [--limit N]       every action and refused connection

  AI (Model Context Protocol, stdio):
  neledport mcp [--allow-create]       for an AI on this machine
  neledport mcp --machine <ip[:port]>  for another machine; its pairing code in NELEDPORT_CODE

  <server> is an id or a name. Add --machine <ip[:port]> (and NELEDPORT_CODE) to watch or control another
  machine, --json for raw output. Data: NELEDPORT_DATA (default: the desktop app's folder).`

export interface Parsed {
  command: string
  args: string[]
  flags: { machine?: string; code?: string; role?: string; port?: string; host?: string; lines?: string; limit?: string; json?: boolean; 'allow-create'?: boolean }
  settings: Record<string, string>
}

export function parseCommand(argv: string[]): Parsed {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      set: { type: 'string', multiple: true },
      machine: { type: 'string' },
      code: { type: 'string' },
      role: { type: 'string' },
      port: { type: 'string' },
      host: { type: 'string' },
      lines: { type: 'string' },
      limit: { type: 'string' },
      json: { type: 'boolean' },
      'allow-create': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' }
    }
  })
  const { set, help, version: v, ...flags } = values
  const settings: Record<string, string> = {}
  for (const pair of set ?? []) {
    const i = pair.indexOf('=')
    if (i < 1) throw new Error(`--set takes key=value, not "${pair}"`)
    settings[pair.slice(0, i)] = pair.slice(i + 1)
  }
  const [command = 'help', ...args] = positionals
  if (help) return { command: 'help', args: [], flags, settings }
  if (v) return { command: 'version', args: [], flags, settings }
  if (!COMMANDS.includes(command)) throw new Error(`Unknown command: ${command} (see neledport help)`)
  return { command, args, flags, settings }
}

/** Where the desktop app keeps its data (Electron's userData), so the CLI and the app share servers and devices. */
export function dataDirFor(platform: string, home: string, env: Env): string {
  if (env.NELEDPORT_DATA) return env.NELEDPORT_DATA
  if (platform === 'win32') return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'NeledPort')
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'NeledPort')
  return join(env.XDG_CONFIG_HOME ?? join(home, '.config'), 'NeledPort')
}

function target(p: Parsed, env: Env, dataDir: string): Target {
  if (!p.flags.machine) return connectLocal(dataDir)
  const code = p.flags.code ?? env.NELEDPORT_CODE
  if (!code) throw new Error('Set NELEDPORT_CODE to the pairing code that machine gave you (or pass --code)')
  const { host, port } = parseAddress(p.flags.machine)
  const { id, key } = parseCode(code)
  return { host, port, identity: id, key }
}

const table = (rows: (string | number | undefined)[][]): string => {
  const cells = rows.map((r) => r.map((c) => String(c ?? '')))
  const widths = cells[0].map((_, i) => Math.max(...cells.map((r) => r[i].length)))
  return cells.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]))).join('  ')).join('\n')
}
const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`

export async function run(argv: string[], env: Env = process.env, io: Io = { out: console.log, err: console.error }): Promise<number> {
  let p: Parsed
  try {
    p = parseCommand(argv)
  } catch (e) {
    io.err((e as Error).message)
    return 2
  }
  const dataDir = dataDirFor(process.platform, homedir(), env)
  if (p.command === 'help') return io.out(HELP), 0
  if (p.command === 'version') return io.out(version), 0
  if (p.command === 'serve') {
    const { serve } = await import('./serve')
    await serve({ dataDir, serversDir: env.NELEDPORT_SERVERS ?? join(homedir(), 'NeledPort', 'servers'), version, io })
    return 0
  }
  if (p.command === 'mcp') {
    const { startMcp } = await import('./mcpStdio')
    await startMcp({ call: (method, params) => callApi(target(p, env, dataDir), method, params), allowCreate: !!p.flags['allow-create'] && !p.flags.machine, version })
    return 0
  }

  try {
    const call = (method: string, params: unknown = {}) => callApi(target(p, env, dataDir), method, params)
    const print = (value: unknown, text: () => string) => io.out(p.flags.json ? JSON.stringify(value, null, 2) : text())
    const serverId = async (arg: string | undefined): Promise<string> => {
      if (!arg) throw new Error(`Which server? neledport ${p.command} <id or name>`)
      if (/^[0-9a-f]{8}$/.test(arg)) return arg
      const hits = ((await call('servers.list')) as ServerSummary[]).filter((s) => s.name.toLowerCase() === arg.toLowerCase())
      if (hits.length === 1) return hits[0].id
      throw new Error(hits.length ? `Several servers are called "${arg}": use the id` : `No server called "${arg}" (see neledport list)`)
    }
    const listServers = async () => {
      const servers = (await call('servers.list')) as ServerSummary[]
      print(servers, () =>
        servers.length
          ? table([
              ['ID', 'NAME', 'GAME', 'STATUS', 'PLAYERS', 'PORTS'],
              ...servers.map((s) => [s.id, s.name, s.gameName, s.status + (s.updateAvailable ? ' (update)' : ''), s.players ?? '', Object.values(s.ports).join(' ')])
            ])
          : 'No servers yet: neledport games, then neledport create <game> <name>'
      )
    }

    switch (p.command) {
      case 'list':
        await listServers()
        break
      case 'status': {
        const m = (await call('machine.status')) as {
          hostname: string; platform: string; version: string; uptimeSeconds?: number
          cpu: { cores: number; percent: number }; memory: { total: number; free: number }; disk: { total: number; free: number }
        }
        print(m, () =>
          [
            `${m.hostname} (${m.platform}), NeledPort ${m.version}` + (m.uptimeSeconds ? `, up ${Math.round(m.uptimeSeconds / 3600)} h` : ''),
            `CPU ${m.cpu.percent}% of ${m.cpu.cores} cores · memory ${gb(m.memory.total - m.memory.free)} of ${gb(m.memory.total)} · disk ${gb(m.disk.free)} free of ${gb(m.disk.total)}`
          ].join('\n')
        )
        if (!p.flags.json) io.out(''), await listServers()
        break
      }
      case 'games': {
        const q = p.args.join(' ').toLowerCase()
        const games = ((await call('games.list')) as { id: string; name: string; needsSteamAccount: boolean }[]).filter(
          (g) => !q || g.name.toLowerCase().includes(q) || g.id.includes(q)
        )
        print(games, () => table([['ID', 'NAME', ''], ...games.map((g) => [g.id, g.name, g.needsSteamAccount ? 'needs a Steam account' : ''])]))
        break
      }
      case 'create': {
        const [gameId, ...name] = p.args
        if (!gameId || !name.length) throw new Error('neledport create <game> <name> [--set key=value]')
        const s = (await call('servers.create', { gameId, name: name.join(' '), settings: p.settings })) as ServerSummary
        print(s, () => `Created ${s.name} (${s.id}). Next: neledport install ${s.id}`)
        break
      }
      case 'install':
      case 'start':
      case 'restart':
      case 'update':
      case 'backup':
      case 'remove': {
        const id = await serverId(p.args.join(' '))
        if (p.command === 'install' || p.command === 'update') io.err(`${p.command === 'install' ? 'Installing' : 'Updating'}: this can take a while…`)
        const result = await call(`servers.${p.command}`, { id })
        print(result, () => `Done: ${p.command} ${id}`)
        break
      }
      case 'stop': {
        const id = await serverId(p.args.join(' '))
        const { forced } = (await call('servers.stop', { id })) as { forced: boolean }
        print({ forced }, () => (forced ? 'Stopped (it did not quit in time and was closed).' : 'Stopped.'))
        break
      }
      case 'players':
      case 'bans': {
        const list = (await call(`servers.${p.command}`, { id: await serverId(p.args.join(' ')) })) as { id: string; name?: string; reason?: string }[]
        print(list, () => (list.length ? table([['ID', 'NAME', p.command === 'bans' ? 'REASON' : ''], ...list.map((x) => [x.id, x.name, x.reason])]) : 'None.'))
        break
      }
      case 'cmd': {
        const [server, ...words] = p.args
        if (!words.length) throw new Error('neledport cmd <server> <command...>')
        const reply = await call('servers.command', { id: await serverId(server), command: words.join(' ') })
        print(reply, () => String(reply ?? ''))
        break
      }
      case 'logs': {
        const lines = (await call('servers.lines', { id: await serverId(p.args.join(' ')), last: Number(p.flags.lines ?? 100) })) as string[]
        print(lines, () => lines.join('\n'))
        break
      }
      case 'devices': {
        const [action = 'list', ...rest] = p.args
        if (action === 'add') {
          const { device, code } = (await call('devices.add', { name: rest.join(' '), role: p.flags.role ?? 'view' })) as { device: Device; code: string }
          const remote = (await call('remote.get')) as RemoteStatus
          print({ device, code }, () =>
            [
              `Paired "${device.name}" (${device.role}). Its pairing code, shown only now:`,
              '',
              `  ${code}`,
              '',
              'On that PC: NeledPort → Remote → Add machine, with this machine\'s address and the code.',
              remote.listening
                ? `Remote access listens on ${remote.host}:${remote.listening}: open TCP ${remote.listening} in the firewall, for your own addresses only if you can.`
                : `Remote access is off: turn it on with "neledport remote on", then open TCP ${remote.port} in the firewall.`
            ].join('\n')
          )
        } else if (action === 'revoke') {
          const ok = await call('devices.revoke', { id: rest[0] })
          print(ok, () => (ok ? 'Revoked: that device can no longer connect.' : `No device ${rest[0]}`))
        } else {
          const devices = (await call('devices.list')) as Device[]
          print(devices, () =>
            devices.length
              ? table([['ID', 'NAME', 'ROLE', 'LAST SEEN'], ...devices.map((d) => [d.id, d.name, d.role, d.lastSeen ? `${d.lastSeen} from ${d.lastAddress}` : 'never'])])
              : 'No paired devices: neledport devices add <name> --role view|control'
          )
        }
        break
      }
      case 'remote': {
        const [action] = p.args
        const s = (
          action === 'on' || action === 'off'
            ? await call('remote.set', {
                enabled: action === 'on',
                ...(p.flags.port ? { port: Number(p.flags.port) } : {}),
                ...(p.flags.host ? { host: p.flags.host } : {})
              })
            : await call('remote.get')
        ) as RemoteStatus
        print(s, () =>
          s.error
            ? `Remote access could not start: ${s.error}`
            : s.listening
              ? `Remote access is on: ${s.host}:${s.listening}. Pair a PC with: neledport devices add <name> --role control`
              : 'Remote access is off.'
        )
        break
      }
      case 'activity': {
        const entries = (await call('activity.list', { limit: Number(p.flags.limit ?? 50) })) as AuditEntry[]
        print(entries, () =>
          entries.length
            ? table([['TIME', 'DEVICE', 'ADDRESS', 'ACTION', 'SERVER', 'RESULT'], ...entries.map((e) => [e.time, e.device, e.address, e.method, e.server, e.ok ? 'ok' : e.error])])
            : 'Nothing yet.'
        )
        break
      }
      case 'steam-login': {
        const user = p.args[0]
        const exe = (await call('steam.prepare', { user })) as string
        io.out(`SteamCMD asks for ${user}'s password and Steam Guard code itself; NeledPort never sees them.`)
        spawnSync(exe, ['+login', user, '+quit'], { stdio: 'inherit' })
        io.out((await call('steam.check')) ? 'Signed in.' : 'Not signed in: try again.')
        break
      }
    }
    return 0
  } catch (e) {
    io.err((e as Error).message)
    return 1
  }
}
