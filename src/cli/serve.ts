import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCatalog } from '../core/catalog'
import { startHost, steamOwnerMethods } from '../core/host'
import { ServerManager } from '../core/manager'
import type { ServerView } from '../core/types'
import type { Io } from './main'

/** The game definitions: next to the bundled CLI in the package, at the repository root in development. */
export function gamesDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const found = [join(here, '..', 'games'), join(here, '..', '..', 'games')].find((d) => existsSync(join(d, 'schema.json')))
  if (!found) throw new Error('The games folder is missing next to the NeledPort CLI')
  return found
}

// No OS keychain on a server without a desktop: secrets are stored encoded ("v0"), as the app does where the OS has
// none, in files only this user can read. "v1" secrets were sealed by the desktop app's keychain.
const secrets = {
  encrypt: (plain: string) => 'v0:' + Buffer.from(plain).toString('base64'),
  decrypt: (stored: string) => {
    if (stored.startsWith('v1:')) throw new Error("This server's passwords were saved by the desktop app with the system keychain: run it from the app")
    return Buffer.from(stored.slice(3), 'base64').toString()
  }
}

/** Hosts game servers without a window, until Ctrl+C or SIGTERM saves and stops them all. */
export async function serve(o: { dataDir: string; serversDir: string; version: string; io: Io }): Promise<never> {
  if (process.platform !== 'linux' && process.platform !== 'win32') o.io.err('Game servers run on Linux and Windows; on this system NeledPort can only be watched.')
  mkdirSync(o.dataDir, { recursive: true, mode: 0o700 })
  const dir = gamesDir()
  const games = () => loadCatalog(dir).games
  const manager = new ServerManager({
    dataDir: o.dataDir,
    serversDir: o.serversDir,
    platform: process.platform === 'win32' ? 'windows' : 'linux',
    games,
    secrets,
    steamSdkDir: process.platform === 'linux' ? join(homedir(), '.steam') : undefined
  })
  const host = await startHost({ dataDir: o.dataDir, serversDir: o.serversDir, manager, games, version: o.version, owner: steamOwnerMethods(manager) })

  const seen = new Map<string, string>()
  const time = () => new Date().toISOString().slice(0, 19).replace('T', ' ')
  manager.on('changed', (v: ServerView) => {
    if (seen.get(v.id) === v.status) return
    seen.set(v.id, v.status)
    o.io.out(`${time()} ${v.name}: ${v.status}${v.message ? ` (${v.message})` : ''}`)
  })
  const remote = host.remote.status()
  o.io.out(
    [
      `NeledPort ${o.version} is hosting game servers on this machine.`,
      `  servers: ${o.serversDir}`,
      `  data:    ${o.dataDir}`,
      remote.listening
        ? `  remote access: on, ${remote.host}:${remote.listening} (pair a PC: neledport devices add <name> --role control)`
        : remote.error
          ? `  remote access: could not start (${remote.error})`
          : '  remote access: off (neledport remote on)',
      `  ${manager.list().length} server(s); manage them from another terminal: neledport list`,
      'Ctrl+C saves and stops every server, then quits.'
    ].join('\n')
  )

  let stopping = false
  const shutdown = async () => {
    if (stopping) process.exit(1)
    stopping = true
    o.io.out('Saving and stopping every server… (Ctrl+C again quits at once)')
    await manager.stopAll().catch((e: Error) => o.io.err(e.message))
    await host.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  return new Promise<never>(() => {})
}
