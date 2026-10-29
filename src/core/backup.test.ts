import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createBackup, listBackups, pruneBackups, restoreBackup } from './backup'

function world() {
  const root = mkdtempSync(join(tmpdir(), 'bk-'))
  const saveDir = join(root, 'server', 'saves')
  mkdirSync(join(saveDir, 'worlds'), { recursive: true })
  writeFileSync(join(saveDir, 'worlds', 'Dedicated.db'), 'v1')
  return { saveDir, backupsDir: join(root, 'backups') }
}

describe('backups', () => {
  it('creates, lists and restores a backup', async () => {
    const { saveDir, backupsDir } = world()
    const info = await createBackup(saveDir, backupsDir, 'update')
    expect(info?.reason).toBe('update')
    expect(listBackups(backupsDir).map((b) => b.file)).toEqual([info?.file])

    writeFileSync(join(saveDir, 'worlds', 'Dedicated.db'), 'v2-broken')
    await restoreBackup(info!.file, saveDir)
    expect(readFileSync(join(saveDir, 'worlds', 'Dedicated.db'), 'utf8')).toBe('v1')
  })

  it('keeps the replaced world next to it when restoring', async () => {
    const { saveDir, backupsDir } = world()
    const info = await createBackup(saveDir, backupsDir, 'manual')
    writeFileSync(join(saveDir, 'worlds', 'Dedicated.db'), 'v2')
    await restoreBackup(info!.file, saveDir)
    const parent = join(saveDir, '..')
    const kept = readdirSync(parent).find((n) => n.startsWith('saves.before-restore-'))
    expect(kept).toBeDefined()
    expect(readFileSync(join(parent, kept!, 'worlds', 'Dedicated.db'), 'utf8')).toBe('v2')
  })

  it('returns null when there is no world yet', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bk-'))
    expect(await createBackup(join(root, 'missing'), join(root, 'backups'), 'update')).toBeNull()
  })

  it('prunes all but the newest backups', async () => {
    const { saveDir, backupsDir } = world()
    for (let i = 0; i < 3; i++) {
      await createBackup(saveDir, backupsDir, 'scheduled')
      await new Promise((r) => setTimeout(r, 20))
    }
    const newest = listBackups(backupsDir)[0].file
    pruneBackups(backupsDir, 1)
    expect(listBackups(backupsDir).map((b) => b.file)).toEqual([newest])
  })

  it('lists nothing when the folder does not exist', () => {
    expect(listBackups(join(tmpdir(), 'nope-neledport'))).toEqual([])
    expect(existsSync(join(tmpdir(), 'nope-neledport'))).toBe(false)
  })
})
