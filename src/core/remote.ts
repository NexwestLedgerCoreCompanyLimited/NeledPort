import https from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import type { ConnectionOptions, TLSSocket } from 'node:tls'
import type { Api, Caller } from './api'

/**
 * NeledPort's API between machines: HTTPS whose TLS is keyed by the paired device's pre-shared key. No certificates;
 * the key never crosses the network, a wrong one fails the handshake, and ECDHE gives forward secrecy. TLS 1.2,
 * because Electron's BoringSSL does PSK only there (checked in Node 26 and Electron 44, as server and client).
 */
const TLS = { ciphers: 'ECDHE-PSK-CHACHA20-POLY1305', minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2' } as const
export const DEFAULT_REMOTE_PORT = 47800

export interface ApiServer {
  port: number
  close(): Promise<void>
}
export interface ApiServerOptions {
  host: string
  port: number
  api: Api
  /** The key and caller for a PSK identity (a device id), or undefined to refuse it. */
  identify(identity: string): { key: Buffer; caller: Omit<Caller, 'address'> } | undefined
  onRefused?(address: string, reason: string): void
  onConnected?(identity: string, address: string): void
  limits?: { failures?: number; windowMs?: number; blockMs?: number; maxConnections?: number; maxBody?: number }
}

const plainAddress = (a: string | undefined) => (a ?? '').replace(/^::ffff:/, '')

export function startApiServer(o: ApiServerOptions): Promise<ApiServer> {
  const failures = o.limits?.failures ?? 10
  const windowMs = o.limits?.windowMs ?? 10 * 60_000
  const blockMs = o.limits?.blockMs ?? 15 * 60_000
  const maxBody = o.limits?.maxBody ?? 64 * 1024
  const callers = new WeakMap<object, string>()
  const attempts = new Map<string, { count: number; since: number; blockedUntil: number }>()

  const failed = (address: string, reason: string) => {
    const now = Date.now()
    if (attempts.size > 1000) for (const [a, r] of attempts) if (r.since + windowMs < now && r.blockedUntil < now) attempts.delete(a)
    const r = attempts.get(address)
    const rec = r && r.since + windowMs > now ? r : { count: 0, since: now, blockedUntil: 0 }
    rec.count++
    if (rec.count >= failures && rec.blockedUntil < now) {
      rec.blockedUntil = now + blockMs
      o.onRefused?.(address, `blocked for ${Math.round(blockMs / 60_000)} minutes after ${rec.count} failed attempts`)
    } else o.onRefused?.(address, reason)
    attempts.set(address, rec)
  }

  const send = (res: ServerResponse, status: number, body: unknown) =>
    res.writeHead(status, { 'content-type': 'application/json', connection: status === 413 ? 'close' : 'keep-alive' }).end(JSON.stringify(body))

  const handle = (req: IncomingMessage, res: ServerResponse) => {
    // Checked per request, not per connection: a revoke or role change applies to connections already open.
    const identity = callers.get(req.socket)
    const current = identity === undefined ? undefined : o.identify(identity)
    if (!current) return void req.socket.destroy()
    const caller = current.caller
    if (req.method !== 'POST' || req.url !== '/v1') return send(res, 404, { error: 'Not found' })
    if (Number(req.headers['content-length'] ?? 0) > maxBody) {
      req.resume()
      return send(res, 413, { error: 'Request too large' })
    }
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > maxBody) req.socket.destroy()
      else chunks.push(c)
    })
    req.on('end', async () => {
      let request: { method?: unknown; params?: unknown }
      try {
        request = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return send(res, 400, { error: 'Invalid JSON' })
      }
      if (typeof request?.method !== 'string') return send(res, 400, { error: 'Missing method' })
      try {
        const result = await o.api({ role: caller.role, device: caller.device, address: plainAddress(req.socket.remoteAddress) }, request.method, request.params)
        send(res, 200, { result: result ?? null })
      } catch (e) {
        send(res, 400, { error: (e as Error).message })
      }
    })
  }

  const server = https.createServer(
    {
      ...TLS,
      handshakeTimeout: 10_000,
      pskCallback: (socket: TLSSocket, identity: string) => {
        const found = o.identify(identity)
        if (!found) return null
        callers.set(socket, identity)
        return found.key
      }
    },
    handle
  )
  server.maxConnections = o.limits?.maxConnections ?? 32
  server.headersTimeout = 15_000
  server.requestTimeout = 30_000
  server.on('connection', (socket: Socket) => {
    const r = attempts.get(plainAddress(socket.remoteAddress))
    if (r && r.blockedUntil > Date.now()) socket.destroy()
  })
  server.on('tlsClientError', (e: Error & { code?: string }, socket: TLSSocket) => failed(plainAddress(socket.remoteAddress), e.code ?? e.message))
  server.on('secureConnection', (socket: TLSSocket) => {
    const identity = callers.get(socket)
    if (identity) o.onConnected?.(identity, plainAddress(socket.remoteAddress))
  })

  return new Promise((resolve, reject) => {
    server.once('error', (e: Error & { code?: string }) =>
      reject(new Error(e.code === 'EADDRINUSE' ? `Port ${o.port} is already in use` : `Cannot listen on ${o.host}:${o.port}: ${e.message}`))
    )
    server.listen(o.port, o.host, () =>
      resolve({
        port: (server.address() as { port: number }).port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done())
            server.closeAllConnections()
          })
      })
    )
  })
}

export interface Target {
  host: string
  port: number
  identity: string
  key: Buffer
}

/** Calls a NeledPort API; long actions (update, install) get a long timeout. */
export function callApi(t: Target, method: string, params: unknown = {}, timeoutMs = 30 * 60_000): Promise<unknown> {
  const where = `${t.host}:${t.port}`
  const body = JSON.stringify({ method, params })
  return new Promise((resolve, reject) => {
    let secured = false
    const options: https.RequestOptions & Pick<ConnectionOptions, 'pskCallback'> = {
      ...TLS,
      host: t.host,
      port: t.port,
      path: '/v1',
      method: 'POST',
      // A fresh connection per call: nothing lingers to keep a one-shot CLI command alive.
      agent: false,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      // No certificate in PSK mode: the shared key itself proves the server.
      checkServerIdentity: () => undefined,
      pskCallback: () => ({ identity: t.identity, psk: t.key }),
      timeout: timeoutMs
    }
    const req = https.request(options, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        let parsed: { result?: unknown; error?: string } = {}
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          // Reported below with the status.
        }
        if (res.statusCode === 200) resolve(parsed.result)
        else reject(new Error(parsed.error ?? `${where} answered HTTP ${res.statusCode}`))
      })
    })
    req.on('socket', (s) => s.once('secureConnect', () => (secured = true)))
    req.on('timeout', () => req.destroy(new Error(`No answer from ${where} within ${Math.round(timeoutMs / 1000)} s`)))
    req.on('error', (e: Error & { code?: string }) => {
      if (e.code === 'ECONNREFUSED') reject(new Error(`Nothing answers at ${where}: is remote access on there, and the port open in its firewall?`))
      else if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') reject(new Error(`Cannot find ${t.host}`))
      else if (e.code === 'ETIMEDOUT' || e.code === 'EHOSTUNREACH' || e.code === 'ENETUNREACH') reject(new Error(`Cannot reach ${where} (${e.code})`))
      else if (!secured) reject(new Error(`${where} refused the connection: the pairing code was refused, or this address is blocked for a while after too many tries`))
      else reject(e)
    })
    req.end(body)
  })
}

/** "host", "host:port", "[ipv6]:port" or a bare IPv6 address; the port defaults to 47800. */
export function parseAddress(text: string): { host: string; port: number } {
  const s = text.trim()
  const m = /^\[([0-9a-fA-F:.]+)\](?::(\d{1,5}))?$/.exec(s) ?? /^([A-Za-z0-9.-]+)(?::(\d{1,5}))?$/.exec(s)
  const v6 = !m && /^[0-9a-fA-F:]+$/.test(s) && s.includes(':') ? s : undefined
  const host = m?.[1] ?? v6
  const port = m?.[2] ? Number(m[2]) : DEFAULT_REMOTE_PORT
  if (!host || host.startsWith('-') || port < 1 || port > 65535) throw new Error(`Not a machine address: ${text} (IP or name, optionally :port)`)
  return { host, port }
}
