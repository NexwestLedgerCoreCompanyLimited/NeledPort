import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { deviceStore } from './devices'
import { startHost, type Host } from './host'
import { addMachine, machineStore } from './machines'
import { callApi } from './remote'

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

describe('addMachine against a running NeledPort', () => {
  const hosts: Host[] = []
  afterEach(async () => {
    await Promise.all(hosts.splice(0).map((h) => h.close()))
  })
  async function remoteMachine() {
    const dataDir = mkdtempSync(join(tmpdir(), 'neledport-remote-'))
    const manager = { list: () => [{ id: 'ab12cd34', name: 'VPS Valheim', gameName: 'Valheim', status: 'running', ports: {}, admin: { players: false }, build: {} }] }
    const host = await startHost({ dataDir, serversDir: dataDir, manager: manager as never, games: () => [], version: '0.9.0' })
    hosts.push(host)
    const { listening } = await host.remote.set({ enabled: true, host: '127.0.0.1', port: 0 })
    const owner = { role: 'owner' as const }
    const pair = (role: string) => host.api(owner, 'devices.add', { name: 'PC', role }) as Promise<{ code: string }>
    return { address: `127.0.0.1:${listening}`, pair }
  }

  it('checks the code with the machine, keeps it with the role the machine gave, and can call it', async () => {
    const { address, pair } = await remoteMachine()
    const store = machineStore(join(mkdtempSync(join(tmpdir(), 'neledport-machines-')), 'machines.json'), secrets)
    const m = await addMachine(store, { name: '', address, code: (await pair('control')).code })
    expect(m).toMatchObject({ name: expect.any(String), address, role: 'control' })
    expect(m.name.length).toBeLessThanOrEqual(60)
    expect(await callApi(store.target(m.id), 'servers.list')).toEqual([expect.objectContaining({ name: 'VPS Valheim' })])
    expect((await addMachine(store, { name: 'Viewer', address, code: (await pair('view')).code })).role).toBe('view')
  })

  it('stores nothing when the code is wrong or nothing answers', async () => {
    const { address, pair } = await remoteMachine()
    const store = machineStore(join(mkdtempSync(join(tmpdir(), 'neledport-machines-')), 'machines.json'), secrets)
    const { code } = await pair('view')
    const wrong = code.slice(0, 20) + (code[20] === 'A' ? 'B' : 'A') + code.slice(21)
    await expect(addMachine(store, { name: 'x', address, code: wrong })).rejects.toThrow(/refused/)
    await expect(addMachine(store, { name: 'x', address: '127.0.0.1:1', code })).rejects.toThrow(/Nothing answers/)
    await expect(addMachine(store, { name: 'x', address: 'not an address!', code })).rejects.toThrow(/address/)
    expect(store.list()).toEqual([])
  })
})
