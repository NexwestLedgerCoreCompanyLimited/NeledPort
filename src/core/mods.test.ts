import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addPlugin, allowedDownloadHost, installLoader, listPlugins, loaderState, removePlugin, setPluginEnabled, uninstallLoader } from './mods'
import { makeZip } from './testing/zip'
import type { ModLoaderDefinition } from './types'

const oxide: ModLoaderDefinition = {
  id: 'oxide',
  name: 'Oxide',
  download: { linux: 'https://github.com/x/y/releases/latest/download/Oxide.zip' },
  pluginDir: 'oxide/plugins',
  pluginExtensions: ['.cs'],
  reapplyAfterUpdate: true
}

function server() {
  const dir = mkdtempSync(join(tmpdir(), 'mods-'))
  mkdirSync(join(dir, 'RustDedicated_Data/Managed'), { recursive: true })
  writeFileSync(join(dir, 'RustDedicated_Data/Managed/Assembly-CSharp.dll'), 'vanilla')
  return dir
}

const zip = makeZip([
  { name: 'RustDedicated_Data/Managed/Assembly-CSharp.dll', text: 'patched', deflate: true },
  { name: 'RustDedicated_Data/Managed/Oxide.Core.dll', text: 'oxide' }
])
const download = async () => zip

describe('installLoader / uninstallLoader', () => {
  it('records which files it added and which it replaced', async () => {
    const dir = server()
    await installLoader(dir, oxide, 'linux', download)
    expect(readFileSync(join(dir, 'RustDedicated_Data/Managed/Assembly-CSharp.dll'), 'utf8')).toBe('patched')
    expect(loaderState(dir, 'oxide')).toMatchObject({
      added: ['RustDedicated_Data/Managed/Oxide.Core.dll'],
      replaced: ['RustDedicated_Data/Managed/Assembly-CSharp.dll']
    })
  })

  it('keeps its own files as "added" when installed again', async () => {
    const dir = server()
    await installLoader(dir, oxide, 'linux', download)
    await installLoader(dir, oxide, 'linux', download)
    expect(loaderState(dir, 'oxide')?.added).toEqual(['RustDedicated_Data/Managed/Oxide.Core.dll'])
  })

  it('removes added files and says when game files must be restored', async () => {
    const dir = server()
    await installLoader(dir, oxide, 'linux', download)
    expect(uninstallLoader(dir, 'oxide')).toEqual({ needsValidate: true })
    expect(existsSync(join(dir, 'RustDedicated_Data/Managed/Oxide.Core.dll'))).toBe(false)
    expect(loaderState(dir, 'oxide')).toBeNull()
  })

  it('leaves the server untouched when the download fails', async () => {
    const dir = server()
    await expect(installLoader(dir, oxide, 'linux', async () => Promise.reject(new Error('offline')))).rejects.toThrow(/offline/)
    expect(readFileSync(join(dir, 'RustDedicated_Data/Managed/Assembly-CSharp.dll'), 'utf8')).toBe('vanilla')
    expect(loaderState(dir, 'oxide')).toBeNull()
  })

  it('refuses a platform the loader does not support', async () => {
    await expect(installLoader(server(), oxide, 'windows', download)).rejects.toThrow(/windows/)
  })
})

describe('allowedDownloadHost', () => {
  it.each([
    ['https://objects.githubusercontent.com/x', true],
    ['https://github.com/x', true],
    ['https://gcdn.thunderstore.io/x', true],
    ['https://evil.example/x', false],
    ['http://github.com/x', false],
    ['https://githubusercontent.com.evil.example/x', false]
  ])('%s → %s', (url, ok) => {
    expect(allowedDownloadHost(url)).toBe(ok)
  })
})

describe('plugins', () => {
  it('adds, disables, enables and removes plugins', () => {
    const dir = server()
    const src = join(mkdtempSync(join(tmpdir(), 'plug-')), 'Kits.cs')
    writeFileSync(src, '// plugin')
    addPlugin(dir, oxide, src)
    expect(listPlugins(dir, oxide)).toEqual([{ name: 'Kits.cs', enabled: true, size: 9 }])
    setPluginEnabled(dir, oxide, 'Kits.cs', false)
    expect(existsSync(join(dir, 'oxide/plugins/Kits.cs'))).toBe(false)
    expect(listPlugins(dir, oxide)).toEqual([{ name: 'Kits.cs', enabled: false, size: 9 }])
    setPluginEnabled(dir, oxide, 'Kits.cs', true)
    expect(listPlugins(dir, oxide)[0].enabled).toBe(true)
    removePlugin(dir, oxide, 'Kits.cs')
    expect(listPlugins(dir, oxide)).toEqual([])
  })

  it('refuses wrong extensions and path tricks', () => {
    const dir = server()
    const src = join(mkdtempSync(join(tmpdir(), 'plug-')), 'evil.exe')
    writeFileSync(src, 'x')
    expect(() => addPlugin(dir, oxide, src)).toThrow(/\.cs/)
    expect(() => removePlugin(dir, oxide, '../../RustDedicated_Data/Managed/Assembly-CSharp.cs')).toThrow(/plugin name/)
    expect(() => setPluginEnabled(dir, oxide, '..\\x.cs', false)).toThrow(/plugin name/)
  })
})
