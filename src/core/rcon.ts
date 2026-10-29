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

/** One Source RCON command on a fresh connection (srcds, CS2, and others). */
export function rconExec(o: { port: number; password: string; timeoutMs?: number }, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(o.port, '127.0.0.1')
    let buf = Buffer.alloc(0)
    const output: string[] = []
    const done = (err?: Error) => {
      clearTimeout(timer)
      socket.destroy()
      if (err) reject(err)
      else resolve(output.join(''))
    }
    const timer = setTimeout(() => done(new Error('RCON is not reachable (timed out)')), o.timeoutMs ?? 5000)
    socket.on('error', () => done(new Error('RCON is not reachable; is the server running?')))
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
        if (type === AUTH_RESPONSE && id === 1) {
          // The empty packet after the command comes back only after all of its output: that marks the end.
          socket.write(packet(2, EXEC, command))
          socket.write(packet(3, RESPONSE, ''))
        } else if (type === RESPONSE && id === 2) output.push(body)
        else if (type === RESPONSE && id === 3) return done()
      }
    })
  })
}
