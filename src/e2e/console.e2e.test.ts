import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadCatalog } from '../core/catalog'
import { e2e, e2eManager, platform, waitForStatus, withGameLogs } from './harness'

// Real end-to-end run of a game NeledPort drives through its own console (stdin), chosen by NELEDPORT_E2E_GAME:
// SCP: Secret Laboratory. See .github/workflows/e2e.yml.
const gameId = process.env.NELEDPORT_E2E_GAME ?? 'unturned'
const game = loadCatalog(join(__dirname, '../../games')).games.find((g) => g.id === gameId)!

describe.skipIf(!e2e || platform !== 'linux')(`${gameId} on Linux, end to end`, () => {
  it('installs, answers on its console, lists players and quits cleanly', { timeout: 60 * 60_000 }, async () => {
    const manager = e2eManager(mkdtempSync(join(tmpdir(), 'neledport-e2e-')))
    const { id, installDir } = manager.create({ gameId, name: 'NeledPort E2E', settings: {} })
    await manager.install(id)
    const marker = join(installDir, '.neledport-e2e-start')
    writeFileSync(marker, '')
    await withGameLogs(installDir, async () => {
      await manager.start(id)

      // The ready line says the game reads its console; then it has to answer on it.
      await waitForStatus(manager, id, 'running', 20 * 60_000)
      const help = await manager.command(id, 'help')
      console.log('help:', help)
      expect(help).toMatch(/\S/)
      if (game.players?.source === 'console') {
        const reply = await manager.command(id, game.players.command!)
        console.log(`${game.players.command}:`, reply)
        expect(reply).not.toMatch(/does not exist|unknown command|must join/i)
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
})
