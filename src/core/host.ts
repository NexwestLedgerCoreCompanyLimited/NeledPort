import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createApi, type Api, type ApiContext } from './api'
import { auditLog, deviceStore, localAccess, readJson, writePrivate } from './devices'
import { callApi, DEFAULT_REMOTE_PORT, parseAddress, startApiServer, type ApiServer, type Target } from './remote'
import type { ServerManager } from './manager'
import { isSteamUser } from './steamcmd'

export interface RemoteSettings {
  enabled: boolean
  /** The address remote access listens on: 0.0.0.0 for every network, or one of this machine's addresses. */
  host: string
  port: number
}
export interface RemoteStatus extends RemoteSettings {
  listening?: number
  error?: string
}
export interface Host {
  api: Api
  remote: { status(): RemoteStatus; set(s: Partial<RemoteSettings>): Promise<RemoteStatus> }
  close(): Promise<void>
}
export type HostOptions = Omit<ApiContext, 'audit' | 'owner'> & { dataDir: string; owner?: ApiContext['owner'] }

// This machine's own identity on the loopback port; paired devices are 8 hex characters, so they never collide.
const LOCAL = 'local'
const files = (dataDir: string) => ({
  local: join(dataDir, 'local.json'),
  devices: join(dataDir, 'devices.json'),
  audit: join(dataDir, 'audit.log'),
  remote: join(dataDir, 'remote.json')
})

/** How the CLI and the MCP server reach the NeledPort running on this machine (the app or `neledport serve`). */
export function connectLocal(dataDir: string): Target {
  const file = files(dataDir).local
  const port = existsSync(file) ? localAccess(file).port() : undefined
  if (!port) throw new Error('NeledPort is not running on this machine: open the app, or run `neledport serve`')
  return { host: '127.0.0.1', port, identity: LOCAL, key: localAccess(file).key() }
}

/**
 * Serves the API: always to this machine on 127.0.0.1 (owner, by the key in local.json), and to paired devices on
 * the remote port once the owner turns remote access on. One per data folder: it owns the game processes.
 */
export async function startHost(o: HostOptions): Promise<Host> {
  const f = files(o.dataDir)
  const local = localAccess(f.local)
  if (local.port()) {
    const running = await callApi({ host: '127.0.0.1', port: local.port()!, identity: LOCAL, key: local.key() }, 'hello', {}, 3000).then(
      () => true,
      () => false
    )
    if (running) throw new Error('NeledPort is already running on this machine (the app or `neledport serve`)')
  }
  const devices = deviceStore(f.devices)
  const audit = auditLog(f.audit)
  let settings: RemoteSettings = { enabled: false, host: '0.0.0.0', port: DEFAULT_REMOTE_PORT, ...readJson<Partial<RemoteSettings>>(f.remote, {}) }
  let remote: ApiServer | undefined
  let remoteError: string | undefined

  const status = (): RemoteStatus => ({ ...settings, listening: remote?.port, error: remoteError })
  const applyRemote = async () => {
    await remote?.close()
    remote = undefined
    remoteError = undefined
    if (!settings.enabled) return
    try {
      remote = await startApiServer({
        host: settings.host,
        port: settings.port,
        api,
        identify: (id) => {
          const d = devices.lookup(id)
          return d && { key: d.key, caller: { role: d.device.role, device: d.device.name } }
        },
        onConnected: (id, address) => devices.seen(id, address),
        onRefused: (address, reason) => audit.add({ time: new Date().toISOString(), device: 'unknown', address, method: 'connect', ok: false, error: reason })
      })
    } catch (e) {
      remoteError = (e as Error).message
    }
  }
  const setRemote = async (p: Partial<RemoteSettings>): Promise<RemoteStatus> => {
    const next = { ...settings, ...p }
    if (typeof next.enabled !== 'boolean') throw new Error('Remote access is on or off')
    if (!Number.isInteger(next.port) || next.port < 0 || next.port > 65535) throw new Error('Invalid port')
    if (typeof next.host !== 'string' || parseAddress(next.host).host !== next.host) throw new Error(`Not a machine address: ${next.host}`)
    settings = { enabled: next.enabled, host: next.host, port: next.port }
    writePrivate(f.remote, JSON.stringify(settings))
    await applyRemote()
    return status()
  }

  const api: Api = createApi({
    ...o,
    audit: (e) => audit.add(e),
    owner: {
      ...o.owner,
      'devices.list': () => devices.list(),
      'devices.add': (p) => devices.add(String(p.name ?? ''), p.role as 'view' | 'control'),
      'devices.revoke': (p) => devices.revoke(String(p.id ?? '')),
      'remote.get': () => status(),
      'remote.set': (p) => setRemote(p as Partial<RemoteSettings>),
      'activity.list': (p) => audit.list(Math.min(Math.max(Number(p.limit) || 200, 1), 1000))
    }
  })

  const owner = await startApiServer({
    host: '127.0.0.1',
    port: 0,
    api,
    identify: (id) => (id === LOCAL ? { key: local.key(), caller: { role: 'owner' } } : undefined)
  })
  local.setPort(owner.port)
  await applyRemote()

  return {
    api,
    remote: { status, set: setRemote },
    async close() {
      await remote?.close()
      await owner.close()
      local.setPort(undefined)
    }
  }
}

/** Steam sign-in for the CLI on a machine without a screen: it runs SteamCMD in its own terminal, which asks the user. */
export function steamOwnerMethods(m: Pick<ServerManager, 'setSteamAccount' | 'steamCmd' | 'steamSignedIn'>): NonNullable<ApiContext['owner']> {
  return {
    'steam.prepare': async (p) => {
      if (!isSteamUser(p.user)) throw new Error('Invalid Steam account name')
      m.setSteamAccount(p.user)
      return m.steamCmd()
    },
    'steam.check': () => m.steamSignedIn()
  }
}
