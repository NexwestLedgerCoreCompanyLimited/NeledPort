import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { e2e, e2eManager, platform, retry } from './harness'

// Real end-to-end run of one GoldSrc (HLDS, app 90) game on Linux, chosen by NELEDPORT_E2E_GAME:
// counter-strike-1-6 (the default mod) or day-of-defeat (picked with app_set_config). See .github/workflows/e2e.yml.
const gameId = process.env.NELEDPORT_E2E_GAME ?? 'counter-strike-1-6'

describe.skipIf(!e2e || platform !== 'linux')(`${gameId} on Linux, end to end`, () => {
  it('installs the right mod, answers over UDP RCON, bans for real and quits cleanly', { timeout: 45 * 60_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'neledport-e2e-'))
    const manager = e2eManager(root)
    const { id, installDir } = manager.create({ gameId, name: 'NeledPort E2E', settings: { serverName: 'NeledPort E2E', maxPlayers: '8' } })
    const mod = manager.configFiles(id)[0].path.split('/')[0]

    await manager.install(id)
    expect(manager.get(id).status).toBe('stopped')
    // The mod's own game library proves SteamCMD downloaded that game, not only the Half-Life base.
    const dlls = join(installDir, mod, 'dlls')
    console.log(`${mod}/dlls:`, existsSync(dlls) ? readdirSync(dlls) : 'missing')
    expect(existsSync(dlls) && readdirSync(dlls).some((f) => f.endsWith('.so'))).toBe(true)

    // HLDS prints no line NeledPort waits for; RCON answering (after neledport.cfg ran) is the sign it is up.
    await manager.start(id)
    const status = await retry(manager, id, () => manager.command(id, 'status'), 5 * 60_000)
    expect(status).toMatch(/hostname:\s*NeledPort E2E/)
    expect(await manager.players(id)).toEqual([])

    // Real bans in GoldSrc's STEAM_0 form, written by writeid to banned.cfg and read back.
    await manager.ban(id, { id: '[U:1:1999999]', name: 'neledport-e2e' }, 'end-to-end test')
    expect((await manager.bans(id)).map((b) => b.id)).toContain('STEAM_0:1:999999')
    await manager.unban(id, 'STEAM_0:1:999999')
    expect((await manager.bans(id)).map((b) => b.id)).not.toContain('STEAM_0:1:999999')
    await expect(manager.kick(id, { id: 'STEAM_0:0:5', name: 'Nobody' }, '')).rejects.toThrow(/not on the server/)

    // quit over RCON: no forced kill.
    const { forced } = await manager.stop(id)
    expect(forced).toBe(false)
    expect(manager.get(id).status).toBe('stopped')
  })
})
