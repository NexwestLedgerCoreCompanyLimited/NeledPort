import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { e2e, e2eManager, platform, retry } from './harness'

// Real end-to-end run of one Source engine (srcds) game on Linux, chosen by NELEDPORT_E2E_GAME:
// counter-strike-source (32-bit) or team-fortress-2 (64-bit). See .github/workflows/e2e.yml.
const gameId = process.env.NELEDPORT_E2E_GAME ?? 'counter-strike-source'

describe.skipIf(!e2e || platform !== 'linux')(`${gameId} on Linux, end to end`, () => {
  it('installs, answers over RCON, bans for real, quits cleanly and runs SourceMod', { timeout: 55 * 60_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'neledport-e2e-'))
    const manager = e2eManager(root)
    const { id, installDir } = manager.create({ gameId, name: 'NeledPort E2E', settings: { serverName: 'NeledPort E2E', maxPlayers: '8' } })
    const mod = manager.configFiles(id)[0].path.split('/')[0]

    await manager.install(id)
    expect(manager.get(id).status).toBe('stopped')

    // srcds prints no line NeledPort waits for; RCON answering is the sign it is up, with our name and password.
    await manager.start(id)
    const status = await retry(manager, id, () => manager.command(id, 'status'), 5 * 60_000)
    expect(status).toMatch(/hostname:\s*NeledPort E2E/)
    expect(await manager.players(id)).toEqual([])

    // Real bans: an ID in the forms people paste goes in, writeid stores it as [U:1:N], and it comes back out.
    const [given, stored] = gameId === 'team-fortress-2' ? ['76561197961265727', '[U:1:999999]'] : ['STEAM_0:1:999999', '[U:1:1999999]']
    await manager.ban(id, { id: given, name: 'neledport-e2e' }, 'end-to-end test')
    expect((await manager.bans(id)).map((b) => b.id)).toContain(stored)
    await manager.unban(id, stored)
    expect((await manager.bans(id)).map((b) => b.id)).not.toContain(stored)
    await expect(manager.kick(id, { id: '[U:1:5]', name: 'Nobody' }, '')).rejects.toThrow(/not on the server/)

    // quit over RCON: no forced kill.
    const { forced } = await manager.stop(id)
    expect(forced).toBe(false)
    expect(manager.get(id).status).toBe('stopped')
    expect(await manager.backup(id)).not.toBeNull()

    // Real Metamod:Source + SourceMod from AlliedModders, found through their latest-build files.
    await manager.installLoader(id, 'sourcemod')
    await manager.start(id)
    const version = await retry(
      manager,
      id,
      async () => {
        const out = await manager.command(id, 'sm version')
        if (!/SourceMod Version/i.test(out)) throw new Error(`sm version answered: ${out}`)
        return out
      },
      5 * 60_000
    )
    console.log(version)
    expect(await manager.command(id, 'meta list')).toMatch(/SourceMod/)
    await manager.stop(id)

    await manager.uninstallLoader(id, 'sourcemod')
    expect(existsSync(join(installDir, mod, 'addons', 'metamod.vdf'))).toBe(false)
  })
})
