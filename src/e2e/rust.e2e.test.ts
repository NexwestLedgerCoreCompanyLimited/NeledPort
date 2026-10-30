import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { e2e, e2eManager, platform, waitForStatus } from './harness'

// Real end-to-end run on Linux: downloads the Rust dedicated server (~10 GB), starts it on the smallest map, uses
// WebRCON with the generated password (players, a real ban and unban), saves on stop, then runs Oxide.
describe.skipIf(!e2e || platform !== 'linux')('Rust on Linux, end to end', () => {
  it('installs, answers over WebRCON, bans for real, saves on stop and runs Oxide', { timeout: 55 * 60_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'neledport-e2e-'))
    const manager = e2eManager(root)
    const { id, installDir } = manager.create({
      gameId: 'rust',
      name: 'NeledPort E2E',
      settings: { serverName: 'NeledPort E2E', maxPlayers: '4', worldSize: '1000', seed: '1' }
    })

    await manager.install(id)
    expect(manager.get(id).status).toBe('stopped')

    await manager.start(id)
    await waitForStatus(manager, id, 'running', 20 * 60_000)

    expect(await manager.players(id)).toEqual([])
    expect(await manager.command(id, 'status')).toMatch(/hostname/)

    // Rust writes bans to server/neledport/cfg/bans.cfg; NeledPort reads them back from there.
    const player = { id: '76561198000000001', name: 'neledport-e2e' }
    await manager.ban(id, player, 'end-to-end test')
    expect((await manager.bans(id)).map((b) => b.id)).toContain(player.id)
    await manager.unban(id, player.id)
    expect((await manager.bans(id)).map((b) => b.id)).not.toContain(player.id)

    // server.save then quit over WebRCON: Rust writes its world before it exits.
    const { forced } = await manager.stop(id)
    expect(forced).toBe(false)
    expect(manager.get(id).status).toBe('stopped')
    expect(readdirSync(join(installDir, 'server', 'neledport')).some((f) => f.endsWith('.sav'))).toBe(true)
    expect(await manager.backup(id)).not.toBeNull()

    // Real Oxide from GitHub: it patches the game files and announces itself in the server log.
    await manager.installLoader(id, 'oxide')
    await manager.start(id)
    await waitForStatus(manager, id, 'running', 20 * 60_000)
    expect(manager.lines(id).some((l) => /Oxide/i.test(l) && !l.startsWith('[NeledPort]'))).toBe(true)
    expect(existsSync(join(installDir, 'oxide'))).toBe(true)
    await manager.stop(id)

    // Removing Oxide asks SteamCMD to validate, which puts the original game files back.
    await manager.uninstallLoader(id, 'oxide')
    expect(existsSync(join(installDir, 'RustDedicated_Data', 'Managed', 'Oxide.Core.dll'))).toBe(false)
  })
})
