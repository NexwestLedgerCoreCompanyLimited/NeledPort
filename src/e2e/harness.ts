import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadCatalog } from '../core/catalog'
import { ServerManager } from '../core/manager'
import type { Platform, ServerStatus } from '../core/types'

// Shared by the real-server tests: opt-in with NELEDPORT_E2E=1 (see .github/workflows/e2e.yml).
export const e2e = process.env.NELEDPORT_E2E === '1'
export const platform: Platform = process.platform === 'win32' ? 'windows' : 'linux'

/** A manager with the real catalog, SteamCMD and processes, keeping everything under `root`. */
export function e2eManager(root: string, games = true): ServerManager {
  const manager = new ServerManager({
    dataDir: join(root, 'data'),
    serversDir: join(root, 'servers'),
    platform,
    games: () => (games ? loadCatalog(join(__dirname, '../../games')).games : []),
    secrets: { encrypt: (s) => s, decrypt: (s) => s },
    // Same as the app: Linux servers such as Palworld look for steamclient.so under ~/.steam.
    steamSdkDir: platform === 'linux' ? join(homedir(), '.steam') : undefined
  })
  manager.on('line', (_id: string, line: string) => console.log(line))
  return manager
}

const tail = (manager: ServerManager, id: string) => manager.lines(id).slice(-30).join('\n')

export function waitForStatus(manager: ServerManager, id: string, want: ServerStatus, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (manager.get(id).status === want) return resolve()
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${want}; last lines:\n${tail(manager, id)}`)), timeoutMs)
    manager.on('changed', (v) => {
      if (v.id !== id) return
      if (v.status === want) (clearTimeout(timer), resolve())
      if (v.status === 'crashed') (clearTimeout(timer), reject(new Error(`server crashed:\n${tail(manager, id)}`)))
    })
  })
}

/** Retries `fn` every 5 s until it succeeds, the server crashes, or time runs out. */
export async function retry<T>(manager: ServerManager, id: string, fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  const until = Date.now() + timeoutMs
  for (;;) {
    try {
      return await fn()
    } catch (e) {
      if (manager.get(id).status === 'crashed') throw new Error(`server crashed:\n${tail(manager, id)}`)
      if (Date.now() > until) throw new Error(`${(e as Error).message}; last lines:\n${tail(manager, id)}`)
      await new Promise((r) => setTimeout(r, 5_000))
    }
  }
}

/** On failure: the end of every log file the game wrote (many Unreal and Unity servers log only to files). */
export async function withGameLogs<T>(installDir: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (e) {
    // Unity servers keep Player.log under ~/.config/unity3d rather than in their own folder.
    const unity = join(homedir(), '.config', 'unity3d')
    const dirs = [installDir, ...(existsSync(unity) ? [unity] : [])]
    const files = execFileSync('find', [...dirs, '-name', '*.log', '-size', '-50M', '-not', '-path', '*/steamapps/*'], { encoding: 'utf8' }).trim()
    for (const file of files ? files.split('\n') : []) console.log(`--- ${file}\n${execFileSync('tail', ['-n', '60', file], { encoding: 'utf8' })}`)
    // Which ports the server really listens on (a remote console on another port, or none yet).
    console.log(`--- listening sockets\n${execFileSync('ss', ['-lntup'], { encoding: 'utf8' })}`)
    throw e
  }
}
