import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadServers, saveServers, type ServerConfig } from './store'

const server: ServerConfig = {
  id: 'abc',
  name: 'Friends Island',
  gameId: 'palworld',
  installDir: '/srv/pal',
  ports: { game: 8211 },
  settings: { serverName: 'Friends Island' },
  secrets: { password: 'ZW5j' },
  createdAt: '2026-10-30T00:00:00.000Z'
}

const tmp = () => join(mkdtempSync(join(tmpdir(), 'store-')), 'servers.json')

describe('server store', () => {
  it('starts empty when the file does not exist', () => {
    expect(loadServers(tmp())).toEqual({ servers: [] })
  })

  it('saves and loads', () => {
    const file = tmp()
    saveServers(file, [server])
    expect(loadServers(file)).toEqual({ servers: [server] })
  })

  it('moves a corrupt file aside instead of losing it', () => {
    const file = tmp()
    writeFileSync(file, '{"servers": [ broken')
    const result = loadServers(file)
    expect(result.servers).toEqual([])
    expect(result.error).toMatch(/servers\.json/)
    expect(existsSync(file)).toBe(false)
    expect(readdirSync(join(file, '..')).some((n) => n.startsWith('servers.json.bad-'))).toBe(true)
  })

  it('rejects entries with the wrong shape', () => {
    const file = tmp()
    writeFileSync(file, JSON.stringify({ servers: [{ id: 1 }] }))
    expect(loadServers(file).error).toBeDefined()
  })

  it('leaves no temp file behind', () => {
    const file = tmp()
    saveServers(file, [server])
    expect(readdirSync(join(file, '..'))).toEqual(['servers.json'])
  })
})
