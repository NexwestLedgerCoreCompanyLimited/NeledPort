import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { e2e, e2eManager, platform, waitForStatus } from './harness'

// Real end-to-end run on Linux and Windows: downloads SteamCMD and the Valheim dedicated server (~1 GB),
// starts it, stops it, updates it and runs BepInEx.
describe.skipIf(!e2e)(`Valheim on ${platform}, end to end`, () => {
  // Shared so the login check below reuses the SteamCMD this test already downloaded and self-updated.
  let root = ''

  it('installs, starts, stops safely and backs up on update', { timeout: 45 * 60_000 }, async () => {
    root = mkdtempSync(join(tmpdir(), 'neledport-e2e-'))
    const manager = e2eManager(root)
    const { id, installDir } = manager.create({
      gameId: 'valheim',
      name: 'NeledPort E2E',
      settings: { serverName: 'NeledPort E2E', world: 'E2E', password: 'neledport-e2e' }
    })

    await manager.install(id)
    expect(manager.get(id).status).toBe('stopped')

    // A fresh install must be the latest public build, read back from Steam's own app info.
    const build = await manager.checkBuild(id)
    expect(build.error).toBeUndefined()
    expect(build.installed).toBeDefined()
    expect(build.installed).toBe(build.latest)

    await manager.start(id)
    await waitForStatus(manager, id, 'running', 10 * 60_000)
    await new Promise((r) => setTimeout(r, 15_000))

    const { forced } = await manager.stop(id)
    expect(manager.get(id).status).toBe('stopped')
    if (platform === 'linux') {
      // Ctrl+C makes Valheim save the world before it exits.
      expect(forced).toBe(false)
      const worlds = join(installDir, 'saves', 'worlds_local')
      expect(existsSync(worlds) && readdirSync(worlds).some((f) => f.startsWith('E2E'))).toBe(true)
    } else {
      // Windows cannot ask Valheim to save, so NeledPort backs up the world before closing it.
      expect(manager.backups(id).map((b) => b.reason)).toContain('stop')
    }

    await manager.update(id)
    expect(manager.backups(id).map((b) => b.reason)).toContain('update')

    // Real BepInEx from Thunderstore: the loader writes its own log once it has injected into the server.
    await manager.installLoader(id, 'bepinex')
    await manager.start(id)
    await waitForStatus(manager, id, 'running', 10 * 60_000)
    await new Promise((r) => setTimeout(r, 10_000))
    const bepLog = join(installDir, 'BepInEx', 'LogOutput.log')
    expect(existsSync(bepLog)).toBe(true)
    expect(readFileSync(bepLog, 'utf8')).toMatch(/Chainloader/)
    await manager.stop(id)
    await manager.uninstallLoader(id, 'bepinex')
    expect(existsSync(join(installDir, 'BepInEx', 'core', 'BepInEx.Preloader.dll'))).toBe(false)
  })

  it('reports an account that never signed in as signed out, without hanging on the password prompt', { timeout: 5 * 60_000 }, async () => {
    root ||= mkdtempSync(join(tmpdir(), 'neledport-e2e-'))
    const manager = e2eManager(root, false)
    manager.setSteamAccount('neledport_e2e_nobody')
    const started = Date.now()
    expect(await manager.steamSignedIn()).toBe(false)
    // Well under the 90 s limit means SteamCMD answered on its own instead of being killed while waiting.
    expect(Date.now() - started).toBeLessThan(80_000)
  })
})
