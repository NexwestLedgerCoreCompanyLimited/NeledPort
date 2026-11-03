import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiManager } from './api'
import { parseCode } from './devices'
import { connectLocal, startHost, type Host } from './host'
import { callApi } from './remote'

function fakeManager() {
  return {
    list: vi.fn(() => []),
    get: vi.fn(),
    lines: vi.fn(() => []),
    players: vi.fn(async () => []),
    bans: vi.fn(async () => []),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => ({ forced: false })),
    restart: vi.fn(async () => {}),
    update: vi.fn(async () => {}),
    backup: vi.fn(async () => null),
    command: vi.fn(async () => ''),
    kick: vi.fn(async () => {}),
    ban: vi.fn(async () => {}),
    unban: vi.fn(async () => {}),
    create: vi.fn(),
    install: vi.fn(async () => {}),
    remove: vi.fn()
  } as unknown as ApiManager & { start: ReturnType<typeof vi.fn> }
}

const hosts: Host[] = []
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((h) => h.close()))
})
async function host(dataDir = mkdtempSync(join(tmpdir(), 'neledport-host-'))) {
  const manager = fakeManager()
  const h = await startHost({ dataDir, serversDir: dataDir, manager, games: () => [], version: '0.9.0' })
  hosts.push(h)
  return { h, manager, dataDir }
}
const asDevice = (port: number, code: string, method: string, params: unknown = {}) => {
  const { id, key } = parseCode(code)
  return callApi({ host: '127.0.0.1', port, identity: id, key }, method, params)
}

describe('host', () => {
  it('lets this machine (the CLI, the MCP server) in as owner through the loopback key', async () => {
    const { dataDir } = await host()
    const local = connectLocal(dataDir)
    expect(local.host).toBe('127.0.0.1')
    expect(await callApi(local, 'hello')).toMatchObject({ version: '0.9.0' })
    expect(await callApi(local, 'devices.list')).toEqual([])
  })

  it('says so when NeledPort is not running here', () => {
    expect(() => connectLocal(mkdtempSync(join(tmpdir(), 'neledport-host-')))).toThrow(/not running/)
  })

  it('refuses to run twice on the same data', async () => {
    const { dataDir } = await host()
    await expect(startHost({ dataDir, serversDir: dataDir, manager: fakeManager(), games: () => [], version: '0.9.0' })).rejects.toThrow(
      /already running/
    )
  })

  it('keeps remote access off until the owner turns it on', async () => {
    const { h, dataDir } = await host()
    expect(h.remote.status()).toMatchObject({ enabled: false, listening: undefined })
    const local = connectLocal(dataDir)
    const status = (await callApi(local, 'remote.set', { enabled: true, host: '127.0.0.1', port: 0 })) as { listening: number }
    expect(status.listening).toBeGreaterThan(0)
    const { code } = (await callApi(local, 'devices.add', { name: 'Laptop', role: 'control' })) as { code: string }
    expect(await asDevice(status.listening, code, 'hello')).toMatchObject({ version: '0.9.0' })
    await callApi(local, 'remote.set', { enabled: false })
    await expect(asDevice(status.listening, code, 'hello')).rejects.toThrow(/Nothing answers/)
  })

  it('gives each paired device its role, and forgets a revoked one', async () => {
    const { dataDir, manager } = await host()
    const local = connectLocal(dataDir)
    const { listening: port } = (await callApi(local, 'remote.set', { enabled: true, host: '127.0.0.1', port: 0 })) as { listening: number }
    const viewer = (await callApi(local, 'devices.add', { name: 'Phone', role: 'view' })) as { code: string; device: { id: string } }
    const controller = (await callApi(local, 'devices.add', { name: 'Laptop', role: 'control' })) as { code: string }

    await expect(asDevice(port, viewer.code, 'servers.start', { id: 'ab12cd34' })).rejects.toThrow(/not allowed/)
    await asDevice(port, controller.code, 'servers.start', { id: 'ab12cd34' })
    expect(manager.start).toHaveBeenCalledTimes(1)
    await expect(asDevice(port, controller.code, 'devices.list')).rejects.toThrow(/not allowed/)

    await callApi(local, 'devices.revoke', { id: viewer.device.id })
    await expect(asDevice(port, viewer.code, 'hello')).rejects.toThrow(/refused/)
    const activity = (await callApi(local, 'activity.list', { limit: 20 })) as { device: string; method: string; ok: boolean }[]
    expect(activity.map((a) => `${a.device} ${a.method} ${a.ok}`)).toEqual(
      expect.arrayContaining(['Phone servers.start false', 'Laptop servers.start true', 'unknown connect false'])
    )
    expect((await callApi(local, 'devices.list')) as unknown[]).toEqual([expect.objectContaining({ name: 'Laptop', lastAddress: '127.0.0.1' })])
  })

  it('never lets the loopback owner key in from the remote port', async () => {
    const { dataDir } = await host()
    const local = connectLocal(dataDir)
    const { listening } = (await callApi(local, 'remote.set', { enabled: true, host: '127.0.0.1', port: 0 })) as { listening: number }
    await expect(callApi({ ...local, port: listening }, 'hello')).rejects.toThrow(/refused/)
  })

  it('remembers remote access across restarts', async () => {
    const { h, dataDir } = await host()
    await callApi(connectLocal(dataDir), 'remote.set', { enabled: true, host: '127.0.0.1', port: 0 })
    await h.close()
    hosts.splice(hosts.indexOf(h), 1)
    const again = await host(dataDir)
    expect(again.h.remote.status()).toMatchObject({ enabled: true, host: '127.0.0.1' })
    expect(again.h.remote.status().listening).toBeGreaterThan(0)
  })

  it('refuses remote settings it cannot use', async () => {
    const { dataDir } = await host()
    const local = connectLocal(dataDir)
    await expect(callApi(local, 'remote.set', { enabled: true, port: 70000 })).rejects.toThrow(/port/)
    await expect(callApi(local, 'remote.set', { enabled: true, host: 'not an address' })).rejects.toThrow(/address/)
  })
})
