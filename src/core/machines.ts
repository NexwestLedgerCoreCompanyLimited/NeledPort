import { randomBytes } from 'node:crypto'
import { parseCode, readJson, writePrivate } from './devices'
import type { Target } from './remote'
import type { MachineInfo } from './types'

export type { MachineInfo }
type Stored = Omit<MachineInfo, 'address'> & { host: string; port: number; code: string }

/** Other machines' addresses and pairing codes; the codes are sealed by the OS keychain (Electron safeStorage). */
export function machineStore(file: string, secrets: { encrypt(plain: string): string; decrypt(stored: string): string }) {
  const load = () => readJson<{ machines: Stored[] }>(file, { machines: [] }).machines ?? []
  const save = (machines: Stored[]) => writePrivate(file, JSON.stringify({ machines }, null, 2))
  const info = (m: Stored): MachineInfo => ({ id: m.id, name: m.name, role: m.role, address: `${m.host.includes(':') ? `[${m.host}]` : m.host}:${m.port}` })
  return {
    list: (): MachineInfo[] => load().map(info),
    add(m: { name: string; host: string; port: number; code: string; role: MachineInfo['role'] }): MachineInfo {
      if (!/^[^\x00-\x1f\x7f]{1,60}$/.test(m.name) || !m.name.trim()) throw new Error('A machine name is 1 to 60 characters on one line')
      parseCode(m.code)
      const stored: Stored = { id: randomBytes(4).toString('hex'), name: m.name.trim(), host: m.host, port: m.port, role: m.role, code: secrets.encrypt(m.code.trim()) }
      save([...load(), stored])
      return info(stored)
    },
    remove: (id: string) => save(load().filter((m) => m.id !== id)),
    target(id: string): Target {
      const m = load().find((x) => x.id === id)
      if (!m) throw new Error('Unknown machine')
      const { id: identity, key } = parseCode(secrets.decrypt(m.code))
      return { host: m.host, port: m.port, identity, key }
    }
  }
}
