import { createHash } from 'node:crypto'
import { connect } from 'node:net'

/**
 * One command over Pavlov VR's RCON (pavlovwiki "Rcon Overview and Commands"): TCP, the server prompts "Password:",
 * takes the lowercase hex MD5 of the password, says "Authenticated=1", then answers each command line with JSON + CRLF.
 */
export function pavlovRconExec(o: { port: number; password: string; timeoutMs?: number }, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(o.port, '127.0.0.1')
    let stage: 'prompt' | 'auth' | 'reply' = 'prompt'
    let text = ''
    let settled = false
    const done = (err?: Error, out?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (err) reject(err)
      else resolve(out ?? '')
    }
    const timer = setTimeout(() => done(new Error('RCON is not reachable (timed out); is the server running?')), o.timeoutMs ?? 5000)
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      text += chunk
      if (stage === 'prompt' && /Password:/i.test(text)) {
        stage = 'auth'
        text = ''
        socket.write(`${createHash('md5').update(o.password).digest('hex')}\n`)
      } else if (stage === 'auth' && /Authenticated=\d/.test(text)) {
        if (!/Authenticated=1/.test(text)) return done(new Error('RCON refused the password'))
        stage = 'reply'
        text = ''
        socket.write(`${command}\n`)
      } else if (stage === 'reply' && text.endsWith('\r\n')) {
        done(undefined, text.trim())
      }
    })
    socket.on('error', (e) => done(new Error(`RCON is not reachable (${e.message})`)))
    socket.on('close', () => done(new Error(stage === 'reply' ? 'RCON closed before answering' : 'RCON refused the password')))
  })
}
