import { connect } from 'node:net'

// The Isle's RCON has no official documentation; opcodes as the isle-evrima-rcon client (MIT) uses them.
const OPCODES: Record<string, number> = { announce: 0x10, dm: 0x11, ban: 0x20, kick: 0x30, players: 0x40, save: 0x50, pause: 0x60 }
// The reply has no end marker; it is complete when nothing more arrives for this long.
const QUIET_MS = 300

/** "PlayerList", a line of SteamIDs, a line of names (both comma-separated): one "<id> <name>" line per player. */
function playerLines(reply: string): string {
  const lines = reply.split('\n').filter((l) => l.trim())
  const start = lines[0]?.trim().toLowerCase() === 'playerlist' ? 1 : 0
  const ids = (lines[start] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const names = (lines[start + 1] ?? '').split(',').map((s) => s.trim())
  return ids.map((id, i) => `${id} ${names[i] || id}`).join('\n')
}

/**
 * One command over The Isle's RCON: TCP, 0x01 <password> 0x00 (answered "Password Accepted"), then
 * 0x02 <opcode> <params> 0x00. Commands are typed as "<name> <params>", such as "kick <steamid>,<reason>".
 */
export function isleRconExec(o: { port: number; password: string; timeoutMs?: number }, command: string): Promise<string> {
  const [name, ...rest] = command.trim().split(' ')
  const opcode = OPCODES[name.toLowerCase()]
  if (opcode === undefined) return Promise.reject(new Error(`The Isle's RCON takes: ${Object.keys(OPCODES).join(', ')}`))
  return new Promise((resolve, reject) => {
    const socket = connect(o.port, '127.0.0.1')
    let authed = false
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
      else resolve(opcode === OPCODES.players ? playerLines(text) : text.trim())
    }
    const timer = setTimeout(() => done(authed ? undefined : new Error('RCON is not reachable (timed out); is the server running?')), o.timeoutMs ?? 5000)
    socket.on('connect', () => socket.write(`\x01${o.password}\x00`, 'latin1'))
    socket.on('data', (data) => {
      if (!authed) {
        if (!data.toString('latin1').includes('Password Accepted')) return done(new Error('RCON refused the password'))
        authed = true
        socket.write(`\x02${String.fromCharCode(opcode)}${rest.join(' ')}\x00`, 'latin1')
        return
      }
      text += data.toString('latin1')
      clearTimeout(quiet)
      quiet = setTimeout(() => done(), QUIET_MS)
    })
    socket.on('error', (e) => done(new Error(`RCON is not reachable (${e.message})`)))
    socket.on('close', () => done(authed ? undefined : new Error('RCON closed the connection before logging in')))
  })
}
