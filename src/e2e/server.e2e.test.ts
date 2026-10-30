import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadCatalog } from '../core/catalog'
import { e2e, e2eManager, platform, retry, waitForStatus } from './harness'

// Real end-to-end run of a game with no remote console, stopped with Ctrl+C, chosen by NELEDPORT_E2E_GAME
// (Core Keeper, Tower Unite, The Front, Chivalry...). See .github/e2e-games.json.
const gameId = process.env.NELEDPORT_E2E_GAME ?? 'core-keeper'
const game = loadCatalog(join(__dirname, '../../games')).games.find((g) => g.id === gameId)!

describe.skipIf(!e2e || platform !== 'linux')(`${gameId} on Linux, end to end`, () => {
  it('installs, comes up, and stops cleanly on Ctrl+C', { timeout: 60 * 60_000 }, async () => {
    const manager = e2eManager(mkdtempSync(join(tmpdir(), 'neledport-e2e-')))
    const { id, installDir } = manager.create({ gameId, name: 'NeledPort E2E', settings: {} })
    await manager.install(id)
    const marker = join(installDir, '.neledport-e2e-start')
    writeFileSync(marker, '')
    await manager.start(id)

    if (game.players?.source === 'a2s') {
      // The Steam query answering is the sign the server finished loading.
      expect(await retry(manager, id, () => manager.players(id), 20 * 60_000)).toEqual([])
    } else if (game.logPatterns?.ready) {
      await waitForStatus(manager, id, 'running', 20 * 60_000)
    } else {
      // Nothing to ask: it has to still be up after three minutes.
      await new Promise((r) => setTimeout(r, 3 * 60_000))
      expect(manager.get(id).status).toBe('running')
      expect(await manager.players(id)).toEqual([])
    }

    const { forced } = await manager.stop(id)
    // Where the game wrote while it ran (its saves and configs), for the definition's backup folder.
    console.log('written while running:\n' + execFileSync('find', [installDir, '-newer', marker, '-type', 'f', '-not', '-path', '*/steamapps/*'], { encoding: 'utf8' }))
    expect(forced).toBe(false)
    expect(manager.get(id).status).toBe('stopped')
    if (game.saveDir) expect(await manager.backup(id)).not.toBeNull()
  })
})
