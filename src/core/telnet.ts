import { connect } from 'node:net'

/**
 * One command on a plain telnet console with no login (Soulmask's -EchoPort, local use only). Resolves with what the
 * console printed: once `until` appears when given (a save reports when it is done), otherwise once it goes quiet.
 */
export function telnetExec(o: { port: number; until?: RegExp; timeoutMs?: number }, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(o.port, '127.0.0.1')
    let text = ''
    let quiet: ReturnType<typeof setTimeout> | undefined
    let settled = false
    const done = (err?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(quiet)
      socket.destroy()
      if (err) reject(err)
      else resolve(text)
    }
    const timer = setTimeout(
      () => (o.until ? done(new Error(`The console never said "${o.until.source}" after ${command}`)) : done()),
      o.timeoutMs ?? 5000
    )
    socket.setEncoding('utf8')
    socket.on('connect', () => socket.write(`${command}\r\n`))
    socket.on('data', (chunk: string) => {
      text += chunk
      if (o.until) {
        if (o.until.test(text)) done()
        return
      }
      clearTimeout(quiet)
      quiet = setTimeout(() => done(), 500)
    })
    socket.on('error', (e) => done(new Error(`The telnet console is not reachable (${e.message})`)))
    socket.on('close', () => done(o.until && !o.until.test(text) ? new Error(`The console closed before saying "${o.until.source}"`) : undefined))
  })
}
