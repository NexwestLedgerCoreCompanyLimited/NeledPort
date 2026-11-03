import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deviceStore } from './devices'
import { machineStore } from './machines'

// Stands in for the OS keychain (Electron safeStorage).
const secrets = { encrypt: (s: string) => 'x:' + Buffer.from(s).toString('hex'), decrypt: (s: string) => Buffer.from(s.slice(2), 'hex').toString() }
const code = () => deviceStore(join(mkdtempSync(join(tmpdir(), 'np-')), 'd.json')).add('PC', 'control').code

describe('machineStore', () => {
  it('keeps the other machines with their pairing codes sealed by the keychain', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'neledport-machines-')), 'machines.json')
    const store = machineStore(file, secrets)
    const c = code()
    const m = store.add({ name: 'VPS', host: '203.0.113.5', port: 47800, code: c, role: 'control' })
    expect(store.list()).toEqual([{ id: m.id, name: 'VPS', address: '203.0.113.5:47800', role: 'control' }])
    expect(readFileSync(file, 'utf8')).not.toContain(c.split('.')[2])
    const target = store.target(m.id)
    expect(target).toMatchObject({ host: '203.0.113.5', port: 47800, identity: c.split('.')[1] })
    expect(target.key.toString('base64url')).toBe(c.split('.')[2])
  })

  it('shows IPv6 addresses in brackets and forgets removed machines', () => {
    const store = machineStore(join(mkdtempSync(join(tmpdir(), 'neledport-machines-')), 'machines.json'), secrets)
    const m = store.add({ name: 'v6', host: '2001:db8::1', port: 47801, code: code(), role: 'view' })
    expect(store.list()[0].address).toBe('[2001:db8::1]:47801')
    store.remove(m.id)
    expect(store.list()).toEqual([])
    expect(() => store.target(m.id)).toThrow(/Unknown machine/)
  })

  it('checks names', () => {
    const store = machineStore(join(mkdtempSync(join(tmpdir(), 'neledport-machines-')), 'machines.json'), secrets)
    expect(() => store.add({ name: 'a\nb', host: 'h', port: 1, code: code(), role: 'view' })).toThrow(/name/)
  })
})
