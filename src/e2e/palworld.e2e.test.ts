import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { e2e, e2eManager, platform, retry } from './harness'

// Real end-to-end run on Linux: downloads the Palworld dedicated server (a few GB), starts it, talks to its
// REST API with the generated admin password, and stops it through that API so the world is saved.
describe.skipIf(!e2e || platform !== 'linux')('Palworld on Linux, end to end', () => {
  it('installs, starts, answers over REST and saves on stop', { timeout: 45 * 60_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'neledport-e2e-'))
    const manager = e2eManager(root)
    const { id, installDir } = manager.create({ gameId: 'palworld', name: 'NeledPort E2E', settings: { serverName: 'NeledPort E2E', maxPlayers: '4' } })

    await manager.install(id)
    expect(manager.get(id).status).toBe('stopped')

    await manager.start(id)
    const ini = readFileSync(join(installDir, 'Pal/Saved/Config/LinuxServer/PalWorldSettings.ini'), 'utf8')
    expect(ini).toContain('ServerName="NeledPort E2E"')
    expect(ini).toContain('RESTAPIEnabled=True')

    // Palworld prints no "ready" line; its REST API answering is the sign it is up.
    expect(await retry(manager, id, () => manager.players(id), 5 * 60_000)).toEqual([])

    const { forced } = await manager.stop(id)
    expect(forced).toBe(false)
    expect(manager.get(id).status).toBe('stopped')
    expect(existsSync(join(installDir, 'Pal/Saved/SaveGames'))).toBe(true)
    expect(await manager.backup(id)).not.toBeNull()
  })
})
