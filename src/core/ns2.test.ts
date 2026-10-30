import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { ns2WebAdmin } from './ns2'

// Stands in for NS2's web admin: HTTP basic auth, ?request=json for the server state, &command=Send&rcon= to run one.
function fakeWebAdmin(password: string): Promise<{ server: Server; port: number; ran: string[] }> {
  const ran: string[] = []
  const server = createServer((req, res) => {
    if (req.headers.authorization !== `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`) {
      res.writeHead(401).end()
      return
    }
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.searchParams.get('command') === 'Send') ran.push(url.searchParams.get('rcon') ?? '')
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({ map: 'ns2_summit', player_list: [{ name: 'Mira', steamid: 1234567, ping: 40, isbot: false }, { name: 'Bot', steamid: 0, ping: 0, isbot: true }] })
    )
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port, ran })))
}

// Same, but asking for HTTP Digest authentication (RFC 7616, MD5, qop=auth) the way NetworkCredential answers it.
function fakeDigestAdmin(password: string): Promise<{ server: Server; port: number; ran: string[] }> {
  const ran: string[] = []
  const md5 = (s: string) => createHash('md5').update(s).digest('hex')
  const server = createServer((req, res) => {
    const header = req.headers.authorization ?? ''
    const field = (name: string) => new RegExp(`${name}="?([^",]+)"?`).exec(header)?.[1]
    const ok =
      header.startsWith('Digest ') &&
      field('response') === md5(`${md5(`admin:NS2:${password}`)}:abc123:${field('nc')}:${field('cnonce')}:auth:${md5(`GET:${field('uri')}`)}`)
    if (!ok) {
      res.writeHead(401, { 'WWW-Authenticate': 'Digest realm="NS2", qop="auth", nonce="abc123", opaque="xyz"' }).end()
      return
    }
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.searchParams.get('command') === 'Send') ran.push(url.searchParams.get('rcon') ?? '')
    res.writeHead(200).end(JSON.stringify({ player_list: [] }))
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port, ran })))
}

let current: Server | undefined
afterEach(() => current?.close())

describe('ns2WebAdmin', () => {
  it('reads the server state with the admin login', async () => {
    const w = await fakeWebAdmin('pw')
    current = w.server
    expect((await ns2WebAdmin({ port: w.port, password: 'pw' }).state()).player_list?.[0]).toMatchObject({ name: 'Mira', steamid: 1234567 })
  })

  it('runs console commands, encoded in the address', async () => {
    const w = await fakeWebAdmin('pw')
    current = w.server
    await ns2WebAdmin({ port: w.port, password: 'pw' }).send('sv_kick 1234567 & more')
    expect(w.ran).toEqual(['sv_kick 1234567 & more'])
  })

  it('answers a Digest challenge when the web admin asks for one', async () => {
    const w = await fakeDigestAdmin('pw')
    current = w.server
    expect(await ns2WebAdmin({ port: w.port, password: 'pw' }).state()).toEqual({ player_list: [] })
    await ns2WebAdmin({ port: w.port, password: 'pw' }).send('sv_kick 1234567')
    expect(w.ran).toEqual(['sv_kick 1234567'])
    await expect(ns2WebAdmin({ port: w.port, password: 'nope' }).state()).rejects.toThrow(/401/)
  })

  it('reports a wrong password', async () => {
    const w = await fakeWebAdmin('pw')
    current = w.server
    await expect(ns2WebAdmin({ port: w.port, password: 'nope' }).state()).rejects.toThrow(/401/)
  })

  it('fails clearly when nothing listens', async () => {
    await expect(ns2WebAdmin({ port: 1, password: 'pw' }).state()).rejects.toThrow(/not reachable/)
  })
})
