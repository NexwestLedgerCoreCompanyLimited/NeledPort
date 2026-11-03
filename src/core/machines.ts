import { randomBytes } from 'node:crypto'
import { parseCode, readJson, writePrivate } from './devices'
import { callApi, parseAddress, type Target } from './remote'
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

export type MachineStore = ReturnType<typeof machineStore>

/** Checks that the machine answers this code, then keeps it with the role the machine gave; the name defaults to its own. */
export async function addMachine(store: MachineStore, o: { name: string; address: string; code: string }): Promise<MachineInfo> {
  const { host, port } = parseAddress(o.address)
  const { id, key } = parseCode(o.code)
  const hello = (await callApi({ host, port, identity: id, key }, 'hello', {}, 15_000)) as { hostname: string; role: string }
  const role = hello.role === 'control' ? 'control' : 'view'
  return store.add({ name: o.name.trim() || hello.hostname.slice(0, 60), host, port, code: o.code, role })
}
