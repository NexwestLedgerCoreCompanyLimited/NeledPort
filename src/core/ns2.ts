import { createHash, randomBytes } from 'node:crypto'

export type Ns2State = { player_list?: { name: string; steamid: number; ping?: number; isbot?: boolean }[] }

const md5 = (text: string) => createHash('md5').update(text).digest('hex')

/** The Authorization header answering an HTTP Digest challenge (RFC 7616, MD5, qop=auth), or undefined for another one. */
function digest(challenge: string, user: string, password: string, uri: string): string | undefined {
  if (!/^Digest /i.test(challenge)) return undefined
  const field = (name: string) => new RegExp(`${name}="?([^",]+)"?`, 'i').exec(challenge)?.[1]
  const realm = field('realm') ?? ''
  const nonce = field('nonce') ?? ''
  const opaque = field('opaque')
  const cnonce = randomBytes(8).toString('hex')
  const nc = '00000001'
  const ha1 = md5(`${user}:${realm}:${password}`)
  const ha2 = md5(`GET:${uri}`)
  const qop = /qop="?[^"]*auth/i.test(challenge)
  const response = qop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`)
  return [
    `Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`,
    qop ? `, qop=auth, nc=${nc}, cnonce="${cnonce}"` : '',
    opaque ? `, opaque="${opaque}"` : ''
  ].join('')
}

/**
 * Natural Selection 2's built-in web admin (-webadmin), as NS2AdminLib uses it: logged in as "admin" (Basic, or Digest
 * when the server asks for it); GET /?request=json is the server state with its player list, and
 * &command=Send&rcon=<command> runs a console command.
 */
export function ns2WebAdmin(o: { port: number; password: string }) {
  const basic = 'Basic ' + Buffer.from(`admin:${o.password}`).toString('base64')
  const request = async (uri: string, authorization: string): Promise<Response> => {
    try {
      return await fetch(`http://127.0.0.1:${o.port}${uri}`, { headers: { Authorization: authorization }, signal: AbortSignal.timeout(5000) })
    } catch (e) {
      throw new Error(`The NS2 web admin is not reachable (${(e as Error).message}); is the server running?`)
    }
  }
  const get = async (query: string): Promise<string> => {
    const uri = `/?${query}`
    let res = await request(uri, basic)
    const answer = res.status === 401 ? digest(res.headers.get('www-authenticate') ?? '', 'admin', o.password, uri) : undefined
    if (answer) res = await request(uri, answer)
    if (!res.ok) {
      const scheme = res.headers.get('www-authenticate')
      throw new Error(`The NS2 web admin answered HTTP ${res.status}${scheme ? ` (it asks for: ${scheme})` : ''}`)
    }
    return res.text()
  }
  return {
    state: async (): Promise<Ns2State> => JSON.parse(await get('request=json')) as Ns2State,
    send: async (command: string): Promise<void> => void (await get(`request=json&command=Send&rcon=${encodeURIComponent(command)}`))
  }
}
