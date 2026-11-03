import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { auditLog, deviceStore, localAccess, parseCode } from './devices'

const dir = () => mkdtempSync(join(tmpdir(), 'neledport-devices-'))

describe('deviceStore', () => {
  it('pairs a device with a one-time code that holds its id and key', () => {
    const store = deviceStore(join(dir(), 'devices.json'))
    const { device, code } = store.add('Office PC', 'control')
    expect(device).toMatchObject({ name: 'Office PC', role: 'control' })
    const parsed = parseCode(code)
    expect(parsed.id).toBe(device.id)
    expect(store.lookup(parsed.id)?.key.equals(parsed.key)).toBe(true)
    expect(store.lookup(parsed.id)?.device.role).toBe('control')
  })

  it('never lists keys, and keeps the file private', () => {
    const file = join(dir(), 'devices.json')
    const store = deviceStore(file)
    const { code } = store.add('Phone', 'view')
    expect(JSON.stringify(store.list())).not.toContain(code.split('.')[2])
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('revokes one device and keeps the others', () => {
    const store = deviceStore(join(dir(), 'devices.json'))
    const a = store.add('A', 'view').device
    const b = store.add('B', 'view').device
    expect(store.revoke(a.id)).toBe(true)
    expect(store.lookup(a.id)).toBeUndefined()
    expect(store.list().map((d) => d.id)).toEqual([b.id])
    expect(store.revoke(a.id)).toBe(false)
  })

  it('sees a device another process added (the CLI pairs while the app runs)', () => {
    const file = join(dir(), 'devices.json')
    const app = deviceStore(file)
    expect(app.list()).toEqual([])
    const { device } = deviceStore(file).add('Laptop', 'control')
    expect(app.lookup(device.id)?.device.name).toBe('Laptop')
  })

  it('refuses owner devices and odd names', () => {
    const store = deviceStore(join(dir(), 'devices.json'))
    expect(() => store.add('x', 'owner' as never)).toThrow(/role/)
    expect(() => store.add('', 'view')).toThrow(/name/)
    expect(() => store.add('a\nb', 'view')).toThrow(/name/)
    expect(() => store.add('x'.repeat(41), 'view')).toThrow(/name/)
  })

  it('remembers when a device was last seen', () => {
    const store = deviceStore(join(dir(), 'devices.json'))
    const { device } = store.add('Laptop', 'view')
    store.seen(device.id, '198.51.100.7')
    expect(store.list()[0]).toMatchObject({ lastAddress: '198.51.100.7', lastSeen: expect.any(String) })
  })

  it('rewrites the file for a sighting at most once a minute from the same address', () => {
    const file = join(dir(), 'devices.json')
    const store = deviceStore(file)
    const { device } = store.add('Laptop', 'view')
    store.seen(device.id, '198.51.100.7')
    const first = readFileSync(file, 'utf8')
    store.seen(device.id, '198.51.100.7')
    expect(readFileSync(file, 'utf8')).toBe(first)
    store.seen(device.id, '198.51.100.8')
    expect(store.list()[0].lastAddress).toBe('198.51.100.8')
  })

  it('treats a broken file as no devices rather than crashing', () => {
    const file = join(dir(), 'devices.json')
    writeFileSync(file, '{not json')
    expect(deviceStore(file).list()).toEqual([])
  })
})

describe('parseCode', () => {
  it('reads codes with spaces around them and rejects malformed ones', () => {
    const { code } = deviceStore(join(dir(), 'devices.json')).add('A', 'view')
    expect(parseCode(`  ${code}\n`).id).toMatch(/^[0-9a-f]{8}$/)
    for (const bad of ['', 'np1', 'np1.zz.abc', 'np2.0123abcd.' + 'A'.repeat(43), 'np1.0123abcd.short']) {
      expect(() => parseCode(bad)).toThrow(/pairing code/)
    }
  })
})

describe('localAccess', () => {
  it('makes one private key for this machine and records the port it listens on', () => {
    const file = join(dir(), 'local.json')
    const a = localAccess(file)
    a.setPort(41234)
    const b = localAccess(file)
    expect(b.key().equals(a.key())).toBe(true)
    expect(b.port()).toBe(41234)
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
  })
})

describe('auditLog', () => {
  const entry = (n: number) => ({ time: `2026-11-03T00:00:0${n}Z`, device: 'Laptop', method: 'servers.stop', ok: true })

  it('lists the newest entries first', () => {
    const log = auditLog(join(dir(), 'audit.log'))
    log.add(entry(1))
    log.add(entry(2))
    expect(log.list(10).map((e) => e.time)).toEqual([entry(2).time, entry(1).time])
    expect(log.list(1)).toHaveLength(1)
  })

  it('keeps one older file when it grows past the limit', () => {
    const file = join(dir(), 'audit.log')
    const log = auditLog(file, 200)
    for (let i = 0; i < 6; i++) log.add(entry(i))
    expect(readFileSync(file, 'utf8').length).toBeLessThanOrEqual(400)
    expect(log.list(100).length).toBeGreaterThanOrEqual(3)
    expect(log.list(100)[0].time).toBe(entry(5).time)
  })
})
