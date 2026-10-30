import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addPlugin, allowedDownloadHost, installLoader, listPlugins, loaderState, removePlugin, setPluginEnabled, uninstallLoader } from './mods'
import { makeTarGz } from './testing/tar'
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

// Metamod:Source + SourceMod: two archives, each found through AlliedModders' "latest build" text file, unpacked into
// the Source game's mod folder (tf/, cstrike/, ...).
const sourcemod: ModLoaderDefinition = {
  id: 'sourcemod',
  name: 'SourceMod',
  download: {
    linux: ['https://mms.alliedmods.net/mmsdrop/1.12/mmsource-latest-linux', 'https://sm.alliedmods.net/smdrop/1.12/sourcemod-latest-linux']
  },
  latestFile: true,
  installTo: 'tf',
  pluginDir: 'tf/addons/sourcemod/plugins',
  pluginExtensions: ['.smx']
}

function alliedmods(overrides: Record<string, Buffer> = {}) {
  const requested: string[] = []
  const files: Record<string, Buffer> = {
    'https://mms.alliedmods.net/mmsdrop/1.12/mmsource-latest-linux': Buffer.from('mmsource-1.12.0-git1228-linux.tar.gz\n'),
    'https://sm.alliedmods.net/smdrop/1.12/sourcemod-latest-linux': Buffer.from('sourcemod-1.12.0-git7259-linux.tar.gz\n'),
    'https://mms.alliedmods.net/mmsdrop/1.12/mmsource-1.12.0-git1228-linux.tar.gz': makeTarGz([
      { name: 'addons/metamod.vdf', text: 'mm' },
      { name: 'addons/metamod/bin/linux64/metamod.2.tf2.so', text: 'so' }
    ]),
    'https://sm.alliedmods.net/smdrop/1.12/sourcemod-1.12.0-git7259-linux.tar.gz': makeTarGz([
      { name: 'addons/sourcemod/plugins/basecommands.smx', text: 'smx' },
      { name: 'cfg/sourcemod/sourcemod.cfg', text: 'cfg' }
    ]),
    ...overrides
  }
  const download = async (url: string) => {
    requested.push(url)
    if (!files[url]) throw new Error(`404 ${url}`)
    return files[url]
  }
  return { requested, download }
}

describe('loaders with several archives (SourceMod)', () => {
  it('finds the latest builds, installs both into the mod folder and records the files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mods-'))
    const { requested, download } = alliedmods()
    await installLoader(dir, sourcemod, 'linux', download)
    expect(requested).toEqual([
      'https://mms.alliedmods.net/mmsdrop/1.12/mmsource-latest-linux',
      'https://mms.alliedmods.net/mmsdrop/1.12/mmsource-1.12.0-git1228-linux.tar.gz',
      'https://sm.alliedmods.net/smdrop/1.12/sourcemod-latest-linux',
      'https://sm.alliedmods.net/smdrop/1.12/sourcemod-1.12.0-git7259-linux.tar.gz'
    ])
    expect(readFileSync(join(dir, 'tf/addons/metamod.vdf'), 'utf8')).toBe('mm')
    expect(loaderState(dir, 'sourcemod')?.added.sort()).toEqual([
      'tf/addons/metamod.vdf',
      'tf/addons/metamod/bin/linux64/metamod.2.tf2.so',
      'tf/addons/sourcemod/plugins/basecommands.smx',
      'tf/cfg/sourcemod/sourcemod.cfg'
    ])
    expect(listPlugins(dir, sourcemod).map((p) => p.name)).toEqual(['basecommands.smx'])
    expect(uninstallLoader(dir, 'sourcemod')).toEqual({ needsValidate: false })
    expect(existsSync(join(dir, 'tf/addons/sourcemod/plugins/basecommands.smx'))).toBe(false)
  })

  it('touches nothing when the second archive fails to download', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mods-'))
    const { download } = alliedmods({ 'https://sm.alliedmods.net/smdrop/1.12/sourcemod-latest-linux': Buffer.from('sourcemod-9.9.9-missing-linux.tar.gz') })
    await expect(installLoader(dir, sourcemod, 'linux', download)).rejects.toThrow(/404/)
    expect(existsSync(join(dir, 'tf'))).toBe(false)
    expect(loaderState(dir, 'sourcemod')).toBeNull()
  })

  it.each(['../../evil.tar.gz', 'https://evil.example/x.tar.gz', 'not an archive name'])('refuses a latest-build file naming %s', async (name) => {
    const dir = mkdtempSync(join(tmpdir(), 'mods-'))
    const { download } = alliedmods({ 'https://mms.alliedmods.net/mmsdrop/1.12/mmsource-latest-linux': Buffer.from(name) })
    await expect(installLoader(dir, sourcemod, 'linux', download)).rejects.toThrow(/latest build/)
    expect(existsSync(join(dir, 'tf'))).toBe(false)
  })
})

describe('allowedDownloadHost', () => {
  it.each([
    ['https://objects.githubusercontent.com/x', true],
    ['https://github.com/x', true],
    ['https://gcdn.thunderstore.io/x', true],
    ['https://sm.alliedmods.net/smdrop/1.12/sourcemod-latest-linux', true],
    ['https://mms.alliedmods.net/mmsdrop/1.12/mmsource-latest-linux', true],
    ['https://alliedmods.net.evil.example/x', false],
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
