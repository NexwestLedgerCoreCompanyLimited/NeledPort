import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadCatalog } from '../core/catalog'
import { e2e, e2eManager, platform, retry } from './harness'

// Real end-to-end run of one Unreal Engine game that NeledPort drives over RCON with the definition's own commands
// (ARK, Squad, Conan...), chosen by NELEDPORT_E2E_GAME. See .github/workflows/e2e.yml.
const gameId = process.env.NELEDPORT_E2E_GAME ?? 'ark-survival-evolved'
const game = loadCatalog(join(__dirname, '../../games')).games.find((g) => g.id === gameId)!
// Games whose player list comes from A2S: a harmless command that shows what their own listing prints.
const PROBE: Record<string, string> = { 'conan-exiles': 'listplayers', mordhau: 'playerlist', 'operation-harsh-doorstop': 'status' }
// A SteamID64 no player owns (account 1), for the ban round trip.
const nobody = '76561197960265729'

function grepFiles(text: string, dir: string): string {
  try {
    return execFileSync('grep', ['-rlI', '--exclude=*.pak', '--exclude=*.ucas', '--exclude=*.utoc', '--exclude=*.so', text, dir], { encoding: 'utf8' }).trim()
  } catch {
    return '(no file yet)'
  }
}

describe.skipIf(!e2e || platform !== 'linux')(`${gameId} on Linux, end to end`, () => {
  it('installs, answers RCON with our password, bans for real and stops cleanly', { timeout: 85 * 60_000 }, async () => {
    const manager = e2eManager(mkdtempSync(join(tmpdir(), 'neledport-e2e-')))
    const { id, installDir } = manager.create({ gameId, name: 'NeledPort E2E', settings: {} })
    await manager.install(id)
    await manager.start(id)

    // RCON answering is the sign the server is up and read the port and password NeledPort wrote into its config.
    const probe = game.players?.command ?? PROBE[gameId] ?? 'help'
    console.log(`${probe}:`, await retry(manager, id, () => manager.command(id, probe), 25 * 60_000))
    if (game.players?.command) expect(await manager.players(id)).toEqual([])

    if (manager.get(id).admin.ban) {
      const banned = gameId === 'insurgency-sandstorm' ? `SteamNWI:${nobody}` : nobody
      await manager.ban(id, { id: banned, name: 'nobody' }, 'end-to-end test')
      // Where the game keeps bans, so a definition can list them: every text file that now holds the ID.
      console.log('ban stored in:', grepFiles(nobody, installDir))
      if (game.bans?.file) expect((await manager.bans(id)).map((b) => b.id)).toContain(nobody)
      await manager.unban(id, banned)
      if (game.bans?.file) expect((await manager.bans(id)).map((b) => b.id)).not.toContain(nobody)
    }

    const { forced } = await manager.stop(id)
    expect(forced).toBe(false)
    expect(manager.get(id).status).toBe('stopped')
    if (game.saveDir) expect(await manager.backup(id)).not.toBeNull()
  })
})
