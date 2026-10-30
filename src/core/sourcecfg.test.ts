import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeSourceConfig } from './sourcecfg'

describe('writeSourceConfig', () => {
  it('creates the server config with the name and RCON password', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'srccfg-')), 'tf', 'cfg', 'neledport.cfg')
    writeSourceConfig(file, { hostname: 'Wasteland EU | Weekly wipe', rconPassword: 'p4ss-word_1' })
    const cfg = readFileSync(file, 'utf8')
    expect(cfg).toMatch(/^hostname "Wasteland EU \| Weekly wipe"$/m)
    expect(cfg).toMatch(/^rcon_password "p4ss-word_1"$/m)
  })

  it("keeps the user's own lines and replaces only the two NeledPort sets", () => {
    const file = join(mkdtempSync(join(tmpdir(), 'srccfg-')), 'neledport.cfg')
    writeFileSync(file, '// my settings\r\nsv_password "friends"\r\nHostName "old name"\r\n  rcon_password "old"\r\nmp_timelimit 30\r\n')
    writeSourceConfig(file, { hostname: 'New name', rconPassword: 'new' })
    expect(readFileSync(file, 'utf8')).toBe('// my settings\nsv_password "friends"\nmp_timelimit 30\nhostname "New name"\nrcon_password "new"\n')
  })

  it('keeps quotes and line breaks out of the values, which would run other commands', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'srccfg-')), 'neledport.cfg')
    writeSourceConfig(file, { hostname: 'Evil"; rcon_password "x\nquit', rconPassword: 'pw' })
    const lines = readFileSync(file, 'utf8').trim().split('\n')
    expect(lines).toEqual(['// NeledPort sets hostname and rcon_password here on every start; the rest is yours.', 'hostname "Evil; rcon_password x quit"', 'rcon_password "pw"'])
  })
})
