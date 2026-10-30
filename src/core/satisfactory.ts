import { request } from 'node:https'

export type ApiPost = (fn: string, data: object, token?: string) => Promise<{ status: number; body: unknown }>

type Reply = { data?: { authenticationToken?: string; commandResult?: string; serverGameState?: { activeSessionName?: string } }; errorCode?: string; errorMessage?: string }

/** One call to the server's HTTPS API on the game port: POST /api/v1 { function, data }, Bearer token. */
function httpsPost(port: number): ApiPost {
  return (fn, data, token) =>
    new Promise((resolve, reject) => {
      const body = JSON.stringify({ function: fn, data })
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path: '/api/v1',
          method: 'POST',
          // The server signs its own certificate; this only ever talks to the server on this machine.
          rejectUnauthorized: false,
          // The API answers on the game thread, which can be busy for seconds while a level loads or a save runs.
          timeout: 30_000,
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...(token ? { Authorization: `Bearer ${token}` } : {}) }
        },
        (res) => {
          let text = ''
          res.setEncoding('utf8')
          res.on('data', (chunk: string) => (text += chunk))
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : undefined })
            } catch {
              reject(new Error(`Satisfactory ${fn} answered with something that is not JSON (HTTP ${res.statusCode})`))
            }
          })
        }
      )
      req.on('timeout', () => req.destroy(new Error('the server API did not answer (timed out); is the server running?')))
      req.on('error', (e) => reject(new Error(`Satisfactory API is not reachable (${e.message})`)))
      req.end(body)
    })
}

/**
 * Satisfactory's Dedicated Server API (docs ship with the server in CommunityResources/DedicatedServerAPIDocs.md).
 * Logs in with the admin password set when the server was claimed, or without one while it is unclaimed.
 */
export function satisfactoryApi(o: { port: number; password?: string; post?: ApiPost }) {
  const post = o.post ?? httpsPost(o.port)
  const call = async (fn: string, data: object, token?: string): Promise<Reply> => {
    const { status, body } = await post(fn, data, token)
    const reply = (body ?? {}) as Reply
    if (status < 200 || status >= 300) throw new Error(`Satisfactory ${fn}: ${reply.errorMessage ?? reply.errorCode ?? `HTTP ${status}`}`)
    return reply
  }
  const login = async (): Promise<string> => {
    const reply = o.password
      ? await call('PasswordLogin', { MinimumPrivilegeLevel: 'Administrator', Password: o.password })
      : await call('PasswordlessLogin', { MinimumPrivilegeLevel: 'InitialAdmin' })
    const token = reply.data?.authenticationToken
    if (!token) throw new Error('Satisfactory did not return a login token')
    return token
  }
  return {
    async saveAndShutdown(): Promise<void> {
      const token = await login()
      const session = (await call('QueryServerState', {}, token)).data?.serverGameState?.activeSessionName
      if (session) await call('SaveGame', { SaveName: `${session}_neledport` }, token)
      await call('Shutdown', {}, token)
    },
    async command(text: string): Promise<string> {
      const token = await login()
      return (await call('RunCommand', { Command: text }, token)).data?.commandResult ?? ''
    }
  }
}
