import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadCatalog } from './catalog'

const valid = {
  id: 'example',
  name: 'Example Game',
  serverAppId: 123,
  anonymous: true,
  tier: 'basic',
  platforms: { linux: { executable: 'server.sh', args: ['-port={port:game}'] } },
  ports: [{ name: 'game', default: 27015, protocol: 'udp' }]
}

function dirWith(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-'))
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof content === 'string' ? content : JSON.stringify(content))
  }
  return dir
}

describe('loadCatalog', () => {
  it('loads a valid definition', () => {
    const { games, errors } = loadCatalog(dirWith({ 'example.json': valid }))
    expect(errors).toEqual([])
    expect(games.map((g) => g.id)).toEqual(['example'])
  })

  it('reports invalid JSON without throwing', () => {
    const { games, errors } = loadCatalog(dirWith({ 'example.json': valid, 'bad.json': '{bad' }))
    expect(games).toHaveLength(1)
    expect(errors).toHaveLength(1)
    expect(errors[0].file).toBe('bad.json')
  })

  it('reports schema violations with the file name', () => {
    const { serverAppId: _omit, ...missing } = valid
    const { games, errors } = loadCatalog(dirWith({ 'example.json': missing }))
    expect(games).toEqual([])
    expect(errors[0].file).toBe('example.json')
    expect(errors[0].message).toContain('serverAppId')
  })

  it('rejects an id that does not match the filename', () => {
    const { games, errors } = loadCatalog(dirWith({ 'foo.json': { ...valid, id: 'bar' } }))
    expect(games).toEqual([])
    expect(errors[0].file).toBe('foo.json')
  })

  it.each(['../x', '/etc/x', 'C:\\x', 'a/../../x', 'a\\..\\x', '\\\\server\\x'])(
    'rejects unsafe path %s',
    (path) => {
      const def = { ...valid, platforms: { linux: { executable: path, args: [] } } }
      const { games, errors } = loadCatalog(dirWith({ 'example.json': def }))
      expect(games).toEqual([])
      expect(errors[0].message).toContain(path)
    }
  )

  it('rejects unsafe config file and save paths', () => {
    const def = {
      ...valid,
      saveDir: '../saves',
      platforms: {
        linux: { executable: 'server.sh', args: [], configFiles: [{ path: '/etc/passwd', format: 'txt' }] }
      }
    }
    const { errors } = loadCatalog(dirWith({ 'example.json': def }))
    expect(errors[0].message).toContain('/etc/passwd')
    expect(errors[0].message).toContain('../saves')
  })

  const loader = {
    id: 'oxide',
    name: 'Oxide',
    download: { linux: 'https://github.com/OxideMod/Oxide.Rust/releases/latest/download/Oxide.Rust-linux.zip' },
    pluginDir: 'oxide/plugins',
    pluginExtensions: ['.cs']
  }

  it('accepts a mod loader from GitHub or Thunderstore', () => {
    const def = { ...valid, modLoaders: [loader, { ...loader, id: 'bep', download: { linux: 'https://thunderstore.io/package/download/a/b/1.0.0/' } }] }
    expect(loadCatalog(dirWith({ 'example.json': def })).errors).toEqual([])
  })

  it.each(['http://github.com/x.zip', 'https://evil.example/x.zip', 'https://github.com.evil.example/x.zip'])('rejects a loader download from %s', (url) => {
    const def = { ...valid, modLoaders: [{ ...loader, download: { linux: url } }] }
    expect(loadCatalog(dirWith({ 'example.json': def })).errors[0].message).toMatch(/download/)
  })

  it('accepts SourceMod: several AlliedModders archives unpacked into the mod folder', () => {
    const sourcemod = {
      ...loader,
      id: 'sourcemod',
      download: {
        linux: ['https://mms.alliedmods.net/mmsdrop/1.12/mmsource-latest-linux', 'https://sm.alliedmods.net/smdrop/1.12/sourcemod-latest-linux'],
        windows: ['https://mms.alliedmods.net/mmsdrop/1.12/mmsource-latest-windows', 'https://sm.alliedmods.net/smdrop/1.12/sourcemod-latest-windows']
      },
      latestFile: true,
      installTo: 'tf',
      pluginDir: 'tf/addons/sourcemod/plugins',
      pluginExtensions: ['.smx']
    }
    expect(loadCatalog(dirWith({ 'example.json': { ...valid, modLoaders: [sourcemod] } })).errors).toEqual([])
  })

  it('checks every archive of a loader and its install folder', () => {
    const many = { ...valid, modLoaders: [{ ...loader, download: { linux: ['https://github.com/a.zip', 'https://evil.example/b.zip'] } }] }
    expect(loadCatalog(dirWith({ 'example.json': many })).errors[0].message).toMatch(/evil\.example/)
    const outside = { ...valid, modLoaders: [{ ...loader, installTo: '../../home' }] }
    expect(loadCatalog(dirWith({ 'example.json': outside })).errors[0].message).toContain('../../home')
  })

  it('rejects a plugin folder outside the install folder', () => {
    const def = { ...valid, modLoaders: [{ ...loader, pluginDir: '../plugins' }] }
    expect(loadCatalog(dirWith({ 'example.json': def })).errors[0].message).toContain('../plugins')
  })

  it('rejects a ban file outside the install folder', () => {
    const def = { ...valid, bans: { method: 'file', file: '../../.ssh/authorized_keys', format: 'lines' } }
    expect(loadCatalog(dirWith({ 'example.json': def })).errors[0].message).toContain('authorized_keys')
  })

  it('returns an error, not a throw, when the directory is missing', () => {
    const { games, errors } = loadCatalog(join(tmpdir(), 'does-not-exist-neledport'))
    expect(games).toEqual([])
    expect(errors).toHaveLength(1)
  })

  it('sorts games by name', () => {
    const { games } = loadCatalog(
      dirWith({
        'zeta.json': { ...valid, id: 'zeta', name: 'Zeta' },
        'alpha.json': { ...valid, id: 'alpha', name: 'Alpha' }
      })
    )
    expect(games.map((g) => g.id)).toEqual(['alpha', 'zeta'])
  })

  it('accepts settings, env and REST control', () => {
    const def = {
      ...valid,
      settings: [{ key: 'name', label: 'Server name', type: 'text', default: 'Hi' }],
      platforms: {
        linux: { executable: 'server.sh', args: ['-name', '{setting:name}', '-dir', '{installDir}'], env: { A: '{port:game}' } }
      },
      control: { type: 'rest', rest: { port: 'game', basePath: '/v1/api', username: 'admin' } }
    }
    const { errors } = loadCatalog(dirWith({ 'example.json': def }))
    expect(errors).toEqual([])
  })

  it.each(['{port:nope}', '{setting:nope}', '{mystery}'])('rejects undeclared placeholder %s', (arg) => {
    const def = { ...valid, platforms: { linux: { executable: 'server.sh', args: [arg] } } }
    const { games, errors } = loadCatalog(dirWith({ 'example.json': def }))
    expect(games).toEqual([])
    expect(errors[0].message).toContain(arg.slice(1, -1))
  })

  it('accepts {adminPassword} and remote ports, rejects undeclared ones', () => {
    const ok = {
      ...valid,
      platforms: { linux: { executable: 'server.sh', args: ['+rcon.password', '{adminPassword}'] } },
      control: { type: 'webrcon', port: 'game', shutdown: 'quit' },
      players: { source: 'a2s', port: 'game' }
    }
    expect(loadCatalog(dirWith({ 'example.json': ok })).errors).toEqual([])
    const bad = { ...ok, players: { source: 'a2s', port: 'query' } }
    expect(loadCatalog(dirWith({ 'example.json': bad })).errors[0].message).toContain('port:query')
  })

  it('rejects a REST control that points at an undeclared port', () => {
    const def = { ...valid, control: { type: 'rest', rest: { port: 'api', basePath: '/v1/api', username: 'admin' } } }
    const { errors } = loadCatalog(dirWith({ 'example.json': def }))
    expect(errors[0].message).toContain('api')
  })

  it('every definition in games/ is valid', () => {
    const { games, errors } = loadCatalog(join(__dirname, '../../games'))
    expect(errors).toEqual([])
    expect(games.map((g) => g.id)).toContain('palworld')
  })
})
