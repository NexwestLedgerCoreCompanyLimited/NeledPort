import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Platform } from './types'

const LINE = /^OptionSettings=\((.*)\)\s*$/m

// Splits the OptionSettings tuple on top-level commas, keeping quoted strings and nested (lists) intact.
function splitTuple(body: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quoted = false
  let start = 0
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === '"') quoted = !quoted
    else if (!quoted && c === '(') depth++
    else if (!quoted && c === ')') depth--
    else if (!quoted && depth === 0 && c === ',') {
      parts.push(body.slice(start, i))
      start = i + 1
    }
  }
  parts.push(body.slice(start))
  return parts.filter((p) => p.length > 0)
}

/** Raw values as written in the file (strings keep their quotes). */
export function readOptionSettings(ini: string): Record<string, string> {
  const match = LINE.exec(ini)
  if (!match) throw new Error('PalWorldSettings.ini has no OptionSettings line')
  const out: Record<string, string> = {}
  for (const part of splitTuple(match[1])) {
    const eq = part.indexOf('=')
    out[part.slice(0, eq)] = part.slice(eq + 1)
  }
  return out
}

function format(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  if (typeof value === 'number') return String(value)
  // Quotes or line breaks inside a value would let it inject other settings.
  return `"${value.replace(/["\r\n]/g, '')}"`
}

export function writeOptionSettings(ini: string, patch: Record<string, string | number | boolean>): string {
  const values = readOptionSettings(ini)
  for (const [key, value] of Object.entries(patch)) values[key] = format(value)
  const body = Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join(',')
  return ini.replace(LINE, `OptionSettings=(${body})`)
}

export interface PalworldValues {
  serverName: string
  password: string
  adminPassword: string
  maxPlayers: number
  gamePort: number
  restPort: number
}

/** Writes PalWorldSettings.ini for this server and returns its path. */
export function prepareConfig(installDir: string, platform: Platform, v: PalworldValues): string {
  const folder = platform === 'windows' ? 'WindowsServer' : 'LinuxServer'
  const file = join(installDir, 'Pal', 'Saved', 'Config', folder, 'PalWorldSettings.ini')
  let ini = existsSync(file) ? readFileSync(file, 'utf8') : ''
  // The server leaves an empty file on first start; the docs say to start from the default copy.
  if (!LINE.test(ini)) ini = readFileSync(join(installDir, 'DefaultPalWorldSettings.ini'), 'utf8')
  const out = writeOptionSettings(ini, {
    ServerName: v.serverName,
    ServerPassword: v.password,
    AdminPassword: v.adminPassword,
    ServerPlayerMaxNum: v.maxPlayers,
    PublicPort: v.gamePort,
    RESTAPIEnabled: true,
    RESTAPIPort: v.restPort
  })
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, out)
  return file
}

export function palworldRest(o: { port: number; basePath: string; username: string; password: string }) {
  const base = `http://127.0.0.1:${o.port}${o.basePath}`
  const auth = 'Basic ' + Buffer.from(`${o.username}:${o.password}`).toString('base64')

  async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(base + path, {
      method,
      headers: { Authorization: auth, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000)
    })
    if (!res.ok) throw new Error(`Palworld REST ${path} answered HTTP ${res.status}`)
    const text = await res.text()
    return text ? JSON.parse(text) : undefined
  }

  return {
    info: () => call('GET', '/info'),
    players: () => call('GET', '/players') as Promise<{ players?: { name: string; userId: string; ping?: number }[] }>,
    save: () => call('POST', '/save'),
    shutdown: (waittime: number, message: string) => call('POST', '/shutdown', { waittime, message }),
    announce: (message: string) => call('POST', '/announce', { message }),
    kick: (userid: string, message: string) => call('POST', '/kick', { userid, message }),
    ban: (userid: string, message: string) => call('POST', '/ban', { userid, message }),
    unban: (userid: string) => call('POST', '/unban', { userid })
  }
}
