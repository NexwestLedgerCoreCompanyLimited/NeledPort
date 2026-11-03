import { randomBytes } from 'node:crypto'
import { appendFileSync, chmodSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import type { AuditEntry } from './api'

/** A machine paired with this one. Its key is the TLS pre-shared key; owner is never pairable (this machine only). */
export interface Device {
  id: string
  name: string
  role: 'view' | 'control'
  createdAt: string
  lastSeen?: string
  lastAddress?: string
}
type Stored = Device & { key: string }

/** Written whole to a temporary file, then renamed, readable by this user only. */
export function writePrivate(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, text, { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, file)
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback
  } catch {
    return fallback
  }
}

const CODE = /^np1\.([0-9a-f]{8})\.([A-Za-z0-9_-]{43})$/

/** The pairing code typed on the other machine: np1.<device id>.<256-bit key, base64url>. */
export function parseCode(code: string): { id: string; key: Buffer } {
  const m = CODE.exec(code.trim())
  if (!m) throw new Error('This is not a NeledPort pairing code (np1.…)')
  return { id: m[1], key: Buffer.from(m[2], 'base64url') }
}

/** Paired devices, read from disk on each lookup so a device the CLI pairs works in the running app at once. */
export function deviceStore(file: string) {
  const load = () => readJson<{ devices: Stored[] }>(file, { devices: [] }).devices ?? []
  const save = (devices: Stored[]) => writePrivate(file, JSON.stringify({ devices }, null, 2))
  const strip = ({ key: _key, ...device }: Stored): Device => device
  return {
    list: (): Device[] => load().map(strip),
    add(name: string, role: Device['role']): { device: Device; code: string } {
      if (role !== 'view' && role !== 'control') throw new Error('A device role is view or control')
      if (!/^[^\x00-\x1f\x7f]{1,40}$/.test(name) || !name.trim()) throw new Error('A device name is 1 to 40 characters on one line')
      const key = randomBytes(32)
      const device: Device = { id: randomBytes(4).toString('hex'), name: name.trim(), role, createdAt: new Date().toISOString() }
      save([...load(), { ...device, key: key.toString('base64url') }])
      return { device, code: `np1.${device.id}.${key.toString('base64url')}` }
    },
    revoke(id: string): boolean {
      const devices = load()
      const left = devices.filter((d) => d.id !== id)
      if (left.length === devices.length) return false
      save(left)
      return true
    },
    lookup(id: string): { device: Device; key: Buffer } | undefined {
      const d = load().find((x) => x.id === id)
      return d ? { device: strip(d), key: Buffer.from(d.key, 'base64url') } : undefined
    },
    seen(id: string, address: string): void {
      const devices = load()
      const d = devices.find((x) => x.id === id)
      if (!d) return
      d.lastSeen = new Date().toISOString()
      d.lastAddress = address
      save(devices)
    }
  }
}
export type DeviceStore = ReturnType<typeof deviceStore>

/** This machine's own key and the loopback port its owner API listens on, for the CLI and the MCP server. */
export function localAccess(file: string) {
  const load = () => readJson<{ key?: string; port?: number }>(file, {})
  const ensure = (): { key: string; port?: number } => {
    const data = load()
    if (data.key && Buffer.from(data.key, 'base64url').length === 32) return { ...data, key: data.key }
    const fresh = { ...data, key: randomBytes(32).toString('base64url') }
    writePrivate(file, JSON.stringify(fresh))
    return fresh
  }
  return {
    key: (): Buffer => Buffer.from(ensure().key, 'base64url'),
    port: (): number | undefined => load().port,
    setPort: (port: number | undefined) => writePrivate(file, JSON.stringify({ ...ensure(), port }))
  }
}

/** Every action and refused connection, as JSON lines; one older file is kept when it passes `maxBytes`. */
export function auditLog(file: string, maxBytes = 1_000_000) {
  const read = (f: string): AuditEntry[] =>
    existsSync(f)
      ? readFileSync(f, 'utf8')
          .split('\n')
          .filter(Boolean)
          .flatMap((line) => {
            try {
              return [JSON.parse(line) as AuditEntry]
            } catch {
              return []
            }
          })
      : []
  return {
    add(entry: AuditEntry): void {
      if (existsSync(file) && statSync(file).size > maxBytes) renameSync(file, `${file}.1`)
      appendFileSync(file, JSON.stringify(entry) + '\n', { mode: 0o600 })
    },
    list: (limit = 200): AuditEntry[] => [...read(`${file}.1`), ...read(file)].reverse().slice(0, limit)
  }
}
