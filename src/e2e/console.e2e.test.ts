import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadCatalog } from '../core/catalog'
import { e2e, e2eManager, platform, retry, waitForStatus, withGameLogs } from './harness'

// Real end-to-end run of a game NeledPort drives through its own console (stdin), chosen by NELEDPORT_E2E_GAME:
// SCP: Secret Laboratory, Unturned or Hurtworld. See .github/workflows/e2e.yml.
const gameId = process.env.NELEDPORT_E2E_GAME ?? 'unturned'
const game = loadCatalog(join(__dirname, '../../games')).games.find((g) => g.id === gameId)!
// What the player-list command prints once the server reads its console (any other output may be start-up logging).
const READY: Record<string, RegExp> = { 'scp-secret-laboratory': /List of players/i }

describe.skipIf(!e2e || platform !== 'linux')(`${gameId} on Linux, end to end`, () => {
  it('installs, answers on its console, lists players and quits cleanly', { timeout: 60 * 60_000 }, async () => {
    const manager = e2eManager(mkdtempSync(join(tmpdir(), 'neledport-e2e-')))
    const { id, installDir } = manager.create({ gameId, name: 'NeledPort E2E', settings: {} })
    await manager.install(id)
    const marker = join(installDir, '.neledport-e2e-start')
    writeFileSync(marker, '')
    await withGameLogs(installDir, async () => {
      await manager.start(id)

      if (game.players?.source === 'console') {
        const command = game.players.command!
        const reply = await retry(
          manager,
          id,
          async () => {
            const out = await manager.command(id, command)
            if (!READY[gameId].test(out)) throw new Error(`${command} answered: ${out}`)
            return out
          },
          20 * 60_000
        )
        console.log(`${command}:`, reply)
        expect(await manager.players(id)).toEqual([])
      } else if (game.logPatterns?.ready) {
        // Unturned answers the Steam query only with a login token CI does not have; its ready line says it is up.
        await waitForStatus(manager, id, 'running', 20 * 60_000)
        console.log('Players:', await manager.command(id, 'Players'))
      } else {
        // The Steam query answering is the sign the server finished loading.
        expect(await retry(manager, id, () => manager.players(id), 20 * 60_000)).toEqual([])
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
