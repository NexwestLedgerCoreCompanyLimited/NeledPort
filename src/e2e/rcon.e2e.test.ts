import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadCatalog } from '../core/catalog'
import { e2e, e2eManager, platform, retry, withGameLogs } from './harness'

// Real end-to-end run of one Unreal Engine game that NeledPort drives over RCON (or Soulmask's telnet console) with
// the definition's own commands (ARK, Squad, Conan...), chosen by NELEDPORT_E2E_GAME. See .github/workflows/e2e.yml.
const gameId = process.env.NELEDPORT_E2E_GAME ?? 'ark-survival-evolved'
const game = loadCatalog(join(__dirname, '../../games')).games.find((g) => g.id === gameId)!
// Games whose player list comes from A2S: a harmless command that shows what their own listing prints.
const PROBE: Record<string, string> = { 'conan-exiles': 'listplayers', mordhau: 'playerlist', 'operation-harsh-doorstop': 'status', soulmask: 'help', cs2: 'status' }
// Minutes to wait for the remote console: ARK loads for a long time on a 4-core CI machine.
const SLOW_START: Record<string, number> = { 'ark-survival-evolved': 50 }
// Games that write their config folder only after a full start, which a short CI run does not reach (NS2: Combat).
const SAVES_LATER = new Set(['ns2-combat'])
// Games whose ban cannot be checked on an empty CI server, so the reply is logged instead: Pavlov's Ban only finds players
// who are online, and NS2's sv_ban is game Lua that its hotfix scripts keep from loading on a CI machine.
const BANS_LOGGED_ONLY = new Set(['pavlov-vr', 'natural-selection-2', 'ns2-combat'])
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
    await withGameLogs(installDir, async () => {
      await manager.start(id)

      // RCON answering is the sign the server is up and read the port and password NeledPort wrote into its config.
      const probe = game.players?.command ?? PROBE[gameId] ?? 'help'
      console.log(`${probe}:`, await retry(manager, id, () => manager.command(id, probe), (SLOW_START[gameId] ?? 25) * 60_000))
      if (game.players?.command) expect(await manager.players(id)).toEqual([])

      if (game.bans?.format === 'squad-cfg') {
        // Squad's AdminBan only finds players who are online; offline bans are lines in Bans.cfg, which NeledPort lists
        // and unbans by taking the line out and reloading the server config.
        console.log('AdminBan of an offline ID:', await manager.command(id, `AdminBan ${nobody} 0 e2e`))
        const file = join(installDir, game.bans.file!)
        appendFileSync(file, `${nobody}:0 //end-to-end test\n`)
        expect((await manager.bans(id)).map((b) => b.id)).toContain(nobody)
        await manager.unban(id, nobody)
        expect((await manager.bans(id)).map((b) => b.id)).not.toContain(nobody)
        console.log('AdminReloadServerConfig:', await manager.command(id, 'AdminReloadServerConfig'))
      } else if (BANS_LOGGED_ONLY.has(gameId)) {
        console.log('ban of an offline ID:', await manager.command(id, game.bans!.ban!.replace('{id}', nobody).replace('{reason}', 'e2e')))
      } else if (manager.get(id).admin.ban) {
        // Sandstorm prefixes its IDs; NS2 keeps the 32-bit account number (1 for this SteamID64).
        const banned = gameId === 'insurgency-sandstorm' ? `SteamNWI:${nobody}` : game.bans?.format === 'ns2-json' ? '1' : nobody
        await manager.ban(id, { id: banned, name: 'nobody' }, 'end-to-end test')
        // Where the game keeps bans, so a definition can list them: every text file that now holds the ID.
        console.log('ban stored in:', grepFiles(nobody, installDir))
        if (game.bans?.file) expect((await manager.bans(id)).map((b) => b.id)).toContain(banned)
        await manager.unban(id, banned)
        if (game.bans?.file) expect((await manager.bans(id)).map((b) => b.id)).not.toContain(banned)
      }

      const { forced } = await manager.stop(id)
      expect(forced).toBe(false)
      expect(manager.get(id).status).toBe('stopped')
      if (game.saveDir && !SAVES_LATER.has(gameId)) expect(await manager.backup(id)).not.toBeNull()
    })
  })
})
