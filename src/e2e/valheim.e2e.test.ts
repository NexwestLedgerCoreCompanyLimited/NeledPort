import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadCatalog } from '../core/catalog'
import { ServerManager } from '../core/manager'
import type { ServerStatus } from '../core/types'

// Real end-to-end run: downloads SteamCMD and the Valheim dedicated server (~1 GB), starts it, stops it.
// Linux only, opt-in with NELEDPORT_E2E=1 (see .github/workflows/e2e.yml).
const enabled = process.env.NELEDPORT_E2E === '1' && process.platform === 'linux'

function waitForStatus(manager: ServerManager, id: string, want: ServerStatus, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (manager.get(id).status === want) return resolve()
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${want}; last lines:\n${manager.lines(id).slice(-30).join('\n')}`)), timeoutMs)
    manager.on('changed', (v) => {
      if (v.id !== id) return
      if (v.status === want) (clearTimeout(timer), resolve())
      if (v.status === 'crashed') (clearTimeout(timer), reject(new Error(`server crashed:\n${manager.lines(id).slice(-30).join('\n')}`)))
    })
  })
}

describe.skipIf(!enabled)('Valheim on Linux, end to end', () => {
  it('installs, starts, saves on stop and backs up on update', { timeout: 45 * 60_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'neledport-e2e-'))
    const manager = new ServerManager({
      dataDir: join(root, 'data'),
      serversDir: join(root, 'servers'),
      platform: 'linux',
      games: () => loadCatalog(join(__dirname, '../../games')).games,
      secrets: { encrypt: (s) => s, decrypt: (s) => s }
    })
    manager.on('line', (_id: string, line: string) => console.log(line))

    const { id, installDir } = manager.create({
      gameId: 'valheim',
      name: 'NeledPort E2E',
      settings: { serverName: 'NeledPort E2E', world: 'E2E', password: 'neledport-e2e' }
    })

    await manager.install(id)
    expect(manager.get(id).status).toBe('stopped')

    await manager.start(id)
    await waitForStatus(manager, id, 'running', 10 * 60_000)
    await new Promise((r) => setTimeout(r, 15_000))

    const { forced } = await manager.stop(id)
    expect(forced).toBe(false)
    expect(manager.get(id).status).toBe('stopped')
    const worlds = join(installDir, 'saves', 'worlds_local')
    expect(existsSync(worlds) && readdirSync(worlds).some((f) => f.startsWith('E2E'))).toBe(true)

    await manager.update(id)
    expect(manager.backups(id).map((b) => b.reason)).toContain('update')
  })
})
