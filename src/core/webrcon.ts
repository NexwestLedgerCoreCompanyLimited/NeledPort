// Rust closes new WebRCON connections from an address that opens too many in a short time (seen on a real
// server: players, ban and writecfg in a row, then every new connection is dropped for a few seconds). So
// each server gets one connection, kept open while it is used, and replies are matched by Identifier.

type Target = { port: number; password: string; timeoutMs?: number }
type Reply = (err: Error | null, message?: string) => void

interface Connection {
  ws: WebSocket
  pending: Map<number, Reply>
  idle?: ReturnType<typeof setTimeout>
}

const ATTEMPTS = 3
const IDLE_MS = 60_000
const connections = new Map<string, Promise<Connection>>()
let nextIdentifier = Math.floor(Math.random() * 1_000_000) + 1000

/** One command over Rust-style WebRCON (JSON over WebSocket, password in the URL path). */
export async function webRconExec(o: Target, command: string): Promise<string> {
  const conn = await connection(o)
  return new Promise((resolve, reject) => {
    const identifier = nextIdentifier++
    const timer = setTimeout(() => reply(new Error('WebRCON is not reachable (timed out)')), o.timeoutMs ?? 5000)
    const reply: Reply = (err, message) => {
      clearTimeout(timer)
      conn.pending.delete(identifier)
      if (err) reject(err)
      else resolve(message ?? '')
    }
    conn.pending.set(identifier, reply)
    clearTimeout(conn.idle)
    conn.idle = setTimeout(() => conn.ws.close(), IDLE_MS)
    conn.idle.unref?.()
    conn.ws.send(JSON.stringify({ Identifier: identifier, Message: command, Name: 'NeledPort' }))
  })
}

async function connection(o: Target): Promise<Connection> {
  const key = `${o.port}/${o.password}`
  const existing = await connections.get(key)?.catch(() => undefined)
  if (existing?.ws.readyState === WebSocket.OPEN) return existing
  // A closed or failed connection stays in the map until the next command replaces it.
  const opening = openWithRetry(o)
  connections.set(key, opening)
  return opening
}

async function openWithRetry(o: Target): Promise<Connection> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await open(o)
    } catch (e) {
      // Dropped before it opened: nothing was sent, so trying again is safe. Right after startup this happens too.
      if (!(e as { beforeOpen?: boolean }).beforeOpen || attempt === ATTEMPTS) throw e
      await new Promise((r) => setTimeout(r, 500))
    }
  }
}

function open(o: Target): Promise<Connection> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${o.port}/${encodeURIComponent(o.password)}`)
    const conn: Connection = { ws, pending: new Map() }
    let opened = false
    const timer = setTimeout(() => (ws.close(), reject(new Error('WebRCON is not reachable (timed out)'))), o.timeoutMs ?? 5000)
    // Fails the connection and every command waiting on it. The reason tells "wrong password" from "not listening".
    const fail = (err: Error) => {
      clearTimeout(timer)
      clearTimeout(conn.idle)
      if (!opened) return reject(Object.assign(err, { beforeOpen: true }))
      for (const reply of [...conn.pending.values()]) reply(err)
    }
    ws.addEventListener('open', () => {
      opened = true
      clearTimeout(timer)
      resolve(conn)
    })
    ws.addEventListener('message', (e) => {
      try {
        const msg = JSON.parse(String(e.data))
        // Chat and log broadcasts arrive on the same socket with other identifiers.
        conn.pending.get(msg.Identifier)?.(null, String(msg.Message ?? ''))
      } catch {
        // ignore non-JSON frames
      }
    })
    ws.addEventListener('error', (e) => {
      const { message, error } = e as Event & { message?: string; error?: Error }
      fail(new Error(`WebRCON is not reachable (${message || error?.message || 'connection failed'}); check the server is running and the password`))
    })
    ws.addEventListener('close', (e) =>
      fail(new Error(`WebRCON closed the connection (code ${e.code}${e.reason ? `: ${e.reason}` : ''}); wrong password or server not ready`))
    )
  })
}
