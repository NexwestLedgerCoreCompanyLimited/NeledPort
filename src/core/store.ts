import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'

export interface ServerConfig {
  id: string
  name: string
  gameId: string
  installDir: string
  ports: Record<string, number>
  settings: Record<string, string>
  /** Encrypted by the app (Electron safeStorage); core never sees plain text here. */
  secrets: Record<string, string>
  createdAt: string
}

const isRecord = (v: unknown, of: 'string' | 'number'): v is Record<string, never> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every((x) => typeof x === of)

function isServer(v: unknown): v is ServerConfig {
  const s = v as ServerConfig
  return (
    typeof s === 'object' &&
    s !== null &&
    [s.id, s.name, s.gameId, s.installDir, s.createdAt].every((x) => typeof x === 'string') &&
    isRecord(s.ports, 'number') &&
    isRecord(s.settings, 'string') &&
    isRecord(s.secrets, 'string')
  )
}

export function loadServers(file: string): { servers: ServerConfig[]; error?: string } {
  if (!existsSync(file)) return { servers: [] }
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    if (!Array.isArray(data?.servers) || !data.servers.every(isServer)) throw new Error('unexpected content')
    return { servers: data.servers }
  } catch (e) {
    // Never overwrite a file we could not read: keep it for the user and start clean.
    const aside = `${file}.bad-${Date.now()}`
    renameSync(file, aside)
    return { servers: [], error: `${basename(file)} could not be read (${(e as Error).message}); saved as ${basename(aside)}` }
  }
}

export function saveServers(file: string, servers: ServerConfig[]): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify({ servers }, null, 2))
  renameSync(tmp, file)
}
