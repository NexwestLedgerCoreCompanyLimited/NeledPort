import { randomBytes } from 'node:crypto'
import https from 'node:https'
import type { ConnectionOptions } from 'node:tls'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api, Caller } from './api'
import { callApi, parseAddress, startApiServer, type ApiServer } from './remote'

const key = randomBytes(32)
const calls: { caller: Caller; method: string; params: unknown }[] = []
const api: Api = async (caller, method, params) => {
  calls.push({ caller, method, params })
  if (method === 'boom') throw new Error('Install the server first')
  return { echo: params }
}

let server: ApiServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
  calls.length = 0
})

async function start(limits?: { failures?: number }, onRefused = vi.fn()) {
  server = await startApiServer({
    host: '127.0.0.1',
    port: 0,
    api,
    identify: (identity) => (identity === 'ab12cd34' ? { key, caller: { role: 'control', device: 'Laptop' } } : undefined),
    onRefused,
    limits
  })
  return { port: server.port, onRefused }
}
const call = (port: number, k = key, identity = 'ab12cd34', method = 'servers.list', params: unknown = { a: 1 }) =>
  callApi({ host: '127.0.0.1', port, identity, key: k }, method, params)

describe('remote API over TLS-PSK', () => {
  it('runs a call as the paired device, with its address', async () => {
    const { port } = await start()
    expect(await call(port)).toEqual({ echo: { a: 1 } })
    expect(calls[0]).toMatchObject({ caller: { role: 'control', device: 'Laptop', address: '127.0.0.1' }, method: 'servers.list' })
  })

  it('refuses a wrong key or an unknown device before any call runs', async () => {
    const { port, onRefused } = await start()
    await expect(call(port, randomBytes(32))).rejects.toThrow(/pairing code was refused/)
    await expect(call(port, key, 'ffffffff')).rejects.toThrow(/pairing code was refused/)
    expect(calls).toEqual([])
    expect(onRefused).toHaveBeenCalledWith('127.0.0.1', expect.any(String))
  })

  it('blocks an address after too many failed handshakes, even with the right key', async () => {
    const { port } = await start({ failures: 3 })
    for (let i = 0; i < 3; i++) await expect(call(port, randomBytes(32))).rejects.toThrow()
    await expect(call(port)).rejects.toThrow()
    expect(calls).toEqual([])
  })

  it('applies a revoke to connections already open, and a role change to their next request', async () => {
    let device: { key: Buffer; caller: { role: 'control' | 'view'; device: string } } | undefined = { key, caller: { role: 'control', device: 'Laptop' } }
    server = await startApiServer({ host: '127.0.0.1', port: 0, api, identify: () => device })
    const agent = new https.Agent({ keepAlive: true, maxSockets: 1 })
    const post = () =>
      new Promise<number | undefined>((resolve, reject) => {
        const options: https.RequestOptions & Pick<ConnectionOptions, 'pskCallback'> = {
          host: '127.0.0.1',
          port: server!.port,
          path: '/v1',
          method: 'POST',
          agent,
          ciphers: 'ECDHE-PSK-CHACHA20-POLY1305',
          minVersion: 'TLSv1.2',
          maxVersion: 'TLSv1.2',
          checkServerIdentity: () => undefined,
          pskCallback: () => ({ identity: 'ab12cd34', psk: key })
        }
        const req = https.request(options, (res) => (res.resume(), res.on('end', () => resolve(res.statusCode))))
        req.on('error', reject)
        req.end(JSON.stringify({ method: 'servers.list' }))
      })
    expect(await post()).toBe(200)
    device = { key, caller: { role: 'view', device: 'Laptop' } }
    expect(await post()).toBe(200)
    expect(calls.at(-1)?.caller.role).toBe('view')
    device = undefined
    await expect(post()).rejects.toThrow()
    agent.destroy()
    expect(calls).toHaveLength(2)
  })

  it('passes the error of a failed call back', async () => {
    const { port } = await start()
    await expect(call(port, key, 'ab12cd34', 'boom')).rejects.toThrow('Install the server first')
  })

  it('refuses oversized requests', async () => {
    const { port } = await start()
    await expect(call(port, key, 'ab12cd34', 'servers.list', { big: 'x'.repeat(70_000) })).rejects.toThrow(/too large/)
    expect(calls).toEqual([])
  })

  it('answers only POST /v1', async () => {
    const { port } = await start()
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const options: https.RequestOptions & Pick<ConnectionOptions, 'pskCallback'> = {
        host: '127.0.0.1',
        port,
        path: '/',
        method: 'GET',
        ciphers: 'ECDHE-PSK-CHACHA20-POLY1305',
        minVersion: 'TLSv1.2',
        maxVersion: 'TLSv1.2',
        checkServerIdentity: () => undefined,
        pskCallback: () => ({ identity: 'ab12cd34', psk: key })
      }
      const req = https.request(options, (res) => resolve(res.statusCode))
      req.on('error', reject)
      req.end()
    })
    expect(status).toBe(404)
  })

  it('says clearly when nothing listens', async () => {
    await expect(call(1)).rejects.toThrow(/Nothing answers at 127.0.0.1:1/)
  })
})

describe('parseAddress', () => {
  it('reads host, host:port and [IPv6]:port, with 47800 as the default port', () => {
    expect(parseAddress('203.0.113.5')).toEqual({ host: '203.0.113.5', port: 47800 })
    expect(parseAddress(' 203.0.113.5:5000 ')).toEqual({ host: '203.0.113.5', port: 5000 })
    expect(parseAddress('vps.example.com:47801')).toEqual({ host: 'vps.example.com', port: 47801 })
    expect(parseAddress('[2001:db8::1]:47802')).toEqual({ host: '2001:db8::1', port: 47802 })
    expect(parseAddress('2001:db8::1')).toEqual({ host: '2001:db8::1', port: 47800 })
  })

  it('rejects anything else', () => {
    for (const bad of ['', 'http://x', 'a b', 'host:0', 'host:70000', 'host:12ab', '-rf']) expect(() => parseAddress(bad)).toThrow(/address/)
  })
})
