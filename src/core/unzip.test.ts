import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeTarGz } from './testing/tar'
import { makeZip } from './testing/zip'
import { extractArchive, readArchive, readZip } from './unzip'

describe('readZip', () => {
  it('reads stored and deflated entries', () => {
    const zip = makeZip([
      { name: 'a.txt', text: 'hello' },
      { name: 'dir/b.txt', text: 'world '.repeat(50), deflate: true }
    ])
    const entries = readZip(zip)
    expect(entries.map((e) => [e.path, e.data.toString()])).toEqual([
      ['a.txt', 'hello'],
      ['dir/b.txt', 'world '.repeat(50)]
    ])
  })
})

describe('extractArchive', () => {
  it('writes files and can strip the top folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'unzip-'))
    const zip = makeZip([
      { name: 'Pack/BepInEx/core/BepInEx.dll', text: 'dll', deflate: true },
      { name: 'Pack/winhttp.dll', text: 'w' },
      { name: 'README.md', text: 'outside the pack' }
    ])
    const written = extractArchive(zip, dir, { stripTopFolder: 'Pack' })
    expect(written.sort()).toEqual(['BepInEx/core/BepInEx.dll', 'winhttp.dll'])
    expect(readFileSync(join(dir, 'BepInEx/core/BepInEx.dll'), 'utf8')).toBe('dll')
    expect(existsSync(join(dir, 'README.md'))).toBe(false)
  })

  it.each(['../evil.txt', '/etc/evil', 'a/../../evil', 'C:\\evil', 'a\\..\\..\\evil'])('refuses the unsafe entry %s', (name) => {
    const dir = mkdtempSync(join(tmpdir(), 'unzip-'))
    expect(() => extractArchive(makeZip([{ name, text: 'x' }]), join(dir, 'server'))).toThrow(/unsafe path/)
    expect(existsSync(join(dir, 'evil.txt'))).toBe(false)
  })

  it('rejects data that is not a zip', () => {
    expect(() => readZip(Buffer.from('not a zip at all'))).toThrow(/not a zip/)
  })
})

// SourceMod and Metamod:Source publish their Linux builds as .tar.gz.
describe('readArchive (.tar.gz)', () => {
  it('reads files and skips folders', () => {
    const tgz = makeTarGz([
      { name: 'addons/', type: '5' },
      { name: 'addons/metamod.vdf', text: '"Plugin" {}' },
      { name: 'addons/sourcemod/plugins/basecommands.smx', text: 'smx' }
    ])
    expect(readArchive(tgz).map((e) => [e.path, e.data.toString()])).toEqual([
      ['addons/metamod.vdf', '"Plugin" {}'],
      ['addons/sourcemod/plugins/basecommands.smx', 'smx']
    ])
  })

  it('refuses links, which could point outside the server folder', () => {
    expect(() => readArchive(makeTarGz([{ name: 'addons/evil', type: '2', link: '/etc/passwd' }]))).toThrow(/link/)
  })

  it.each(['../evil.txt', '/etc/evil', 'addons/../../evil'])('refuses the unsafe entry %s', (name) => {
    const dir = mkdtempSync(join(tmpdir(), 'untar-'))
    expect(() => extractArchive(makeTarGz([{ name, text: 'x' }]), join(dir, 'server'))).toThrow(/unsafe path/)
    expect(existsSync(join(dir, 'evil.txt'))).toBe(false)
  })
})
