import { createSocket } from 'node:dgram'
import { crc32 } from 'node:zlib'

/** 'B' 'E', the CRC32 (little-endian) of everything after it, 0xFF, then the payload (BERConProtocol.txt v2). */
function packet(payload: Buffer): Buffer {
  const rest = Buffer.concat([Buffer.from([0xff]), payload])
  const crc = Buffer.alloc(4)
  crc.writeUInt32LE(crc32(rest))
  return Buffer.concat([Buffer.from('BE'), crc, rest])
}

/**
 * One command over BattlEye RCon (DayZ, Arma 3), from BattlEye's own protocol description: UDP, a login packet,
 * then the command as sequence number 0. A reply too big for one packet comes in numbered parts; console messages
 * the server pushes meanwhile must be acknowledged or the server drops the client.
 */
export function battleyeExec(o: { port: number; password: string; timeoutMs?: number }, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4')
    const parts: string[] = []
    let settled = false
    const done = (err?: Error, out?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.close()
      if (err) reject(err)
      else resolve(out ?? '')
    }
    const send = (payload: Buffer) => socket.send(packet(payload), o.port, '127.0.0.1')
    const timer = setTimeout(() => done(new Error('BattlEye RCon is not reachable (timed out); is the server running with RCon on?')), o.timeoutMs ?? 5000)
    socket.on('error', (e) => done(new Error(`BattlEye RCon is not reachable (${e.message})`)))
    socket.on('message', (msg) => {
      if (msg.length < 9 || msg.toString('latin1', 0, 2) !== 'BE' || msg.readUInt32LE(2) !== crc32(msg.subarray(6))) return
      const payload = msg.subarray(7)
      if (payload[0] === 0x00) {
        if (payload[1] !== 0x01) return done(new Error('BattlEye RCon refused the password'))
        return send(Buffer.concat([Buffer.from([0x01, 0x00]), Buffer.from(command, 'latin1')]))
      }
      if (payload[0] === 0x02) return send(Buffer.from([0x02, payload[1]]))
      if (payload[0] !== 0x01 || payload[1] !== 0x00) return
      const body = payload.subarray(2)
      // Multi-packet header: 0x00, number of packets, index of this one.
      if (body.length >= 3 && body[0] === 0x00) {
        parts[body[2]] = body.subarray(3).toString('latin1')
        if (parts.filter((p) => p !== undefined).length === body[1]) done(undefined, parts.join(''))
        return
      }
      done(undefined, body.toString('latin1'))
    })
    send(Buffer.concat([Buffer.from([0x00]), Buffer.from(o.password, 'latin1')]))
  })
}
