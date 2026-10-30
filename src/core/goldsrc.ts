import { createSocket } from 'node:dgram'

const HEADER = Buffer.from([0xff, 0xff, 0xff, 0xff])
// The output has no end marker; it is complete when no further packet arrives for this long.
const QUIET_MS = 300

/**
 * One command over GoldSrc (Half-Life 1) RCON: UDP on the game port. Ask for a challenge, send
 * `rcon <challenge> "<password>" <command>`, collect the "l" packets (as xPaw/PHP-Source-Query does).
 */
export function goldsrcRconExec(o: { port: number; password: string; timeoutMs?: number }, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4')
    const output: string[] = []
    let quiet: ReturnType<typeof setTimeout> | undefined
    const done = (err?: Error) => {
      clearTimeout(timer)
      clearTimeout(quiet)
      socket.close()
      if (err) reject(err)
      else resolve(output.join(''))
    }
    const timer = setTimeout(() => done(new Error('RCON is not reachable (timed out); is the server running?')), o.timeoutMs ?? 5000)
    const send = (text: string) => socket.send(Buffer.concat([HEADER, Buffer.from(text)]), o.port, '127.0.0.1')
    socket.on('error', (e) => done(new Error(`RCON is not reachable (${e.message})`)))
    socket.on('message', (msg) => {
      if (msg.length < 5 || msg.readInt32LE(0) !== -1) return
      const body = msg.subarray(4).toString('utf8')
      const challenge = /^challenge rcon (\d+)/.exec(body)
      if (challenge) return void send(`rcon ${challenge[1]} "${o.password}" ${command}\0`)
      if (!body.startsWith('l')) return
      const text = body.slice(1).replace(/\0+$/, '')
      if (text.startsWith('Bad rcon_password')) return done(new Error('RCON refused the password'))
      output.push(text)
      clearTimeout(quiet)
      quiet = setTimeout(() => done(), QUIET_MS)
    })
    send('challenge rcon\n')
  })
}
