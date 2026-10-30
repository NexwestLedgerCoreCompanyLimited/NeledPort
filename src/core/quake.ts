import { createSocket } from 'node:dgram'

const HEADER = Buffer.from([0xff, 0xff, 0xff, 0xff])
// The reply has no end marker; it is complete when no further packet arrives for this long.
const QUIET_MS = 300

/**
 * One command over Quake-style RCON (Warfork, from its sv_oob.c): UDP on the game port, `rcon <password> <command>`,
 * no challenge; the server answers in "print\n" packets.
 */
export function quakeRconExec(o: { port: number; password: string; timeoutMs?: number }, command: string): Promise<string> {
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
    socket.on('error', (e) => done(new Error(`RCON is not reachable (${e.message})`)))
    socket.on('message', (msg) => {
      if (msg.length < 5 || msg.readInt32LE(0) !== -1) return
      const body = msg.subarray(4).toString('utf8')
      if (!body.startsWith('print\n')) return
      const text = body.slice('print\n'.length)
      if (text.startsWith('Bad rcon_password')) return done(new Error('RCON refused the password'))
      output.push(text)
      clearTimeout(quiet)
      quiet = setTimeout(() => done(), QUIET_MS)
    })
    socket.send(Buffer.concat([HEADER, Buffer.from(`rcon ${o.password} ${command}`)]), o.port, '127.0.0.1')
  })
}
