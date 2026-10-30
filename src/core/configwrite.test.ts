import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeConfigValues } from './configwrite'

// A config path inside a fresh folder; written first when the test starts from an existing file.
const file = (text?: string) => {
  const dir = join(mkdtempSync(join(tmpdir(), 'cfgw-')), 'sub')
  if (text !== undefined) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'Game.ini'), text)
  }
  return join(dir, 'Game.ini')
}

describe('writeConfigValues', () => {
  it('sets keys inside an INI section, keeping every other line and the line endings', () => {
    const path = file('[ServerSettings]\r\nRCONPort=27020\r\nMaxPlayers=70\r\n[Other]\r\nRCONPort=1\r\n')
    writeConfigValues(path, { section: 'ServerSettings', values: { RCONPort: '27030', RCONEnabled: 'True' } })
    expect(readFileSync(path, 'utf8')).toBe('[ServerSettings]\r\nRCONPort=27030\r\nMaxPlayers=70\r\nRCONEnabled=True\r\n[Other]\r\nRCONPort=1\r\n')
  })

  it('adds the section when the file or the section is missing', () => {
    const path = file()
    writeConfigValues(path, { section: 'RconPlugin', values: { RconEnabled: '1', RconPort: '25575' } })
    expect(readFileSync(path, 'utf8')).toBe('[RconPlugin]\nRconEnabled=1\nRconPort=25575\n')
  })

  it('writes key=value files without sections (Squad Rcon.cfg)', () => {
    const path = file('// Rcon\nPort=21114\nPassword=\n')
    writeConfigValues(path, { values: { Port: '21115', Password: 'pw' } })
    expect(readFileSync(path, 'utf8')).toBe('// Rcon\nPort=21115\nPassword=pw\n')
  })

  it('writes "key value" files', () => {
    const path = file('hostname old\nsv_lan 0\n')
    writeConfigValues(path, { style: 'space', values: { hostname: 'My server' } })
    expect(readFileSync(path, 'utf8')).toBe('hostname My server\nsv_lan 0\n')
  })

  it('keeps line breaks out of values, which would add other settings', () => {
    const path = file()
    writeConfigValues(path, { values: { Password: 'pw\nAdmin=everyone' } })
    expect(readFileSync(path, 'utf8')).toBe('Password=pw Admin=everyone\n')
  })
})
