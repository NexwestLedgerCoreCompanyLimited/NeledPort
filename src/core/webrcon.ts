/** One command over Rust-style WebRCON (JSON over WebSocket, password in the URL path). */
export function webRconExec(o: { port: number; password: string; timeoutMs?: number }, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const identifier = Math.floor(Math.random() * 1_000_000) + 1000
    const ws = new WebSocket(`ws://127.0.0.1:${o.port}/${encodeURIComponent(o.password)}`)
    let settled = false
    const done = (err: Error | null, value?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      ws.close()
      if (err) reject(err)
      else resolve(value ?? '')
    }
    const timer = setTimeout(() => done(new Error('WebRCON is not reachable (timed out)')), o.timeoutMs ?? 5000)
    ws.addEventListener('open', () => ws.send(JSON.stringify({ Identifier: identifier, Message: command, Name: 'NeledPort' })))
    ws.addEventListener('message', (e) => {
      try {
        const msg = JSON.parse(String(e.data))
        // Chat and log broadcasts arrive on the same socket with other identifiers.
        if (msg.Identifier === identifier) done(null, String(msg.Message ?? ''))
      } catch {
        // ignore non-JSON frames
      }
    })
    ws.addEventListener('error', () => done(new Error('WebRCON is not reachable; check the server is running and the password')))
    ws.addEventListener('close', () => done(new Error('WebRCON closed the connection; wrong password or server not ready')))
  })
}
