import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeZip } from './testing/zip'
import { extractZip, readZip } from './unzip'

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

describe('extractZip', () => {
  it('writes files and can strip the top folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'unzip-'))
    const zip = makeZip([
      { name: 'Pack/BepInEx/core/BepInEx.dll', text: 'dll', deflate: true },
      { name: 'Pack/winhttp.dll', text: 'w' },
      { name: 'README.md', text: 'outside the pack' }
    ])
    const written = extractZip(zip, dir, { stripTopFolder: 'Pack' })
    expect(written.sort()).toEqual(['BepInEx/core/BepInEx.dll', 'winhttp.dll'])
    expect(readFileSync(join(dir, 'BepInEx/core/BepInEx.dll'), 'utf8')).toBe('dll')
    expect(existsSync(join(dir, 'README.md'))).toBe(false)
  })

  it.each(['../evil.txt', '/etc/evil', 'a/../../evil', 'C:\\evil', 'a\\..\\..\\evil'])('refuses the unsafe entry %s', (name) => {
    const dir = mkdtempSync(join(tmpdir(), 'unzip-'))
    expect(() => extractZip(makeZip([{ name, text: 'x' }]), join(dir, 'server'))).toThrow(/unsafe path/)
    expect(existsSync(join(dir, 'evil.txt'))).toBe(false)
  })

  it('rejects data that is not a zip', () => {
    expect(() => readZip(Buffer.from('not a zip at all'))).toThrow(/not a zip/)
  })
})
