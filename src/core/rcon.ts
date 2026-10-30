import { connect } from 'node:net'

const AUTH = 3
const AUTH_RESPONSE = 2
const EXEC = 2
const RESPONSE = 0

function packet(id: number, type: number, body: string): Buffer {
  const b = Buffer.from(body, 'utf8')
  const buf = Buffer.alloc(14 + b.length)
  buf.writeInt32LE(10 + b.length, 0)
  buf.writeInt32LE(id, 4)
  buf.writeInt32LE(type, 8)
  b.copy(buf, 12)
  return buf
}

/**
 * One Source RCON command on a fresh connection (srcds, CS2, and Unreal servers' RCON plugins). The reply is complete
 * once the server goes quiet: the common trick of an empty packet as an end mark fails on servers that never mirror
 * it (MORDHAU, Conan Exiles, HumanitZ, Operation: Harsh Doorstop), and a reply in several packets arrives back to back.
 */
export function rconExec(o: { port: number; password: string; timeoutMs?: number }, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(o.port, '127.0.0.1')
    let buf = Buffer.alloc(0)
    const output: string[] = []
    let sent = false
    let quiet: ReturnType<typeof setTimeout> | undefined
    let settled = false
    const done = (err?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(quiet)
      socket.destroy()
      if (err) reject(err)
      else resolve(output.join(''))
    }
    // Once the command is in, silence is an answer: some servers (HumanitZ) print nothing for it.
    const timer = setTimeout(() => done(sent ? undefined : new Error('RCON is not reachable (timed out)')), o.timeoutMs ?? 5000)
    socket.on('error', () => done(new Error('RCON is not reachable; is the server running?')))
    socket.on('close', () => done(sent ? undefined : new Error('RCON closed the connection before logging in')))
    socket.on('connect', () => socket.write(packet(1, AUTH, o.password)))
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d])
      while (buf.length >= 4 && buf.length >= buf.readInt32LE(0) + 4) {
        const size = buf.readInt32LE(0)
        const id = buf.readInt32LE(4)
        const type = buf.readInt32LE(8)
        const body = buf.subarray(12, 4 + size - 2).toString('utf8')
        buf = buf.subarray(4 + size)
        if (type === AUTH_RESPONSE && id === -1) return done(new Error('RCON refused the password'))
        if (type === AUTH_RESPONSE && id === 1 && !sent) {
          sent = true
          socket.write(packet(2, EXEC, command))
        } else if (type === RESPONSE && id === 2) {
          output.push(body)
          clearTimeout(quiet)
          quiet = setTimeout(() => done(), 500)
        }
      }
    })
  })
}
