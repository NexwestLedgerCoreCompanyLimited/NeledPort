import Ajv2020 from 'ajv/dist/2020'
import { readdirSync, readFileSync } from 'node:fs'
import { join, posix, win32 } from 'node:path'
import schema from '../../games/schema.json'
import { placeholders } from './template'
import type { CatalogError, CatalogResult, GameDefinition } from './types'

const validate = new Ajv2020({ allErrors: true }).compile<GameDefinition>(schema)

// Definitions come from pull requests, so a path must never escape the server's install folder.
function isUnsafePath(p: string): boolean {
  return (
    posix.isAbsolute(p) ||
    win32.isAbsolute(p) ||
    /^[A-Za-z]:/.test(p) ||
    p.split(/[\\/]/).includes('..')
  )
}

function definitionPaths(def: GameDefinition): string[] {
  const paths = [
    def.saveDir,
    def.bans?.file,
    ...(def.modLoaders ?? []).flatMap((l) => [l.pluginDir, l.installTo, l.pluginList, ...(l.setup ?? []).map((s) => s.file)])
  ].filter((p): p is string => !!p)
  for (const platform of Object.values(def.platforms)) {
    if (!platform) continue
    paths.push(platform.executable, ...(platform.configFiles ?? []).map((c) => c.path))
  }
  return paths
}

// Loader archives run code inside the game server, so they may only come from these hosts.
const DOWNLOAD_HOSTS = new Set(['github.com', 'thunderstore.io', 'sm.alliedmods.net', 'mms.alliedmods.net', 'www.amxmodx.org'])

export function isAllowedDownload(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && DOWNLOAD_HOSTS.has(u.hostname)
  } catch {
    return false
  }
}

function undeclaredReferences(def: GameDefinition): string[] {
  const known = new Set([
    'installDir',
    'adminPassword',
    ...def.ports.map((p) => `port:${p.name}`),
    ...(def.settings ?? []).map((s) => `setting:${s.key}`)
  ])
  const used = Object.values(def.platforms).flatMap((p) =>
    p ? [...p.args, ...Object.values(p.env ?? {})].flatMap(placeholders) : []
  )
  for (const loader of def.modLoaders ?? []) {
    for (const env of Object.values(loader.env ?? {})) used.push(...Object.values(env ?? {}).flatMap(placeholders))
  }
  if (def.control?.rest) used.push(`port:${def.control.rest.port}`)
  if (def.control?.port) used.push(`port:${def.control.port}`)
  if (def.players?.port) used.push(`port:${def.players.port}`)
  return [...new Set(used)].filter((name) => !known.has(name))
}

function checkDefinition(file: string, data: unknown): GameDefinition | string {
  if (!validate(data)) {
    return (validate.errors ?? [])
      .map((e) => `${e.instancePath || '/'} ${e.message}${e.params && 'missingProperty' in e.params ? ` '${e.params.missingProperty}'` : ''}`)
      .join('; ')
  }
  if (`${data.id}.json` !== file) return `id '${data.id}' must match the filename`
  const unsafe = definitionPaths(data).filter(isUnsafePath)
  if (unsafe.length) return `unsafe path(s): ${unsafe.join(', ')}`
  const badDownloads = (data.modLoaders ?? []).flatMap((l) => Object.values(l.download).flat()).filter((u) => !isAllowedDownload(u!))
  if (badDownloads.length) return `mod loader download must be HTTPS from ${[...DOWNLOAD_HOSTS].join(', ')}: ${badDownloads.join(', ')}`
  const undeclared = undeclaredReferences(data)
  if (undeclared.length) return `undeclared port or setting: ${undeclared.join(', ')}`
  return data
}

/** Null when the definition would be accepted into games/, otherwise the reason it would not. */
export function validateDefinition(file: string, data: unknown): string | null {
  const result = checkDefinition(file, data)
  return typeof result === 'string' ? result : null
}

export function loadCatalog(dir: string): CatalogResult {
  const games: GameDefinition[] = []
  const errors: CatalogError[] = []

  let files: string[]
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'schema.json')
  } catch (e) {
    return { games, errors: [{ file: dir, message: `cannot read games folder: ${(e as Error).message}` }] }
  }

  for (const file of files) {
    let data: unknown
    try {
      data = JSON.parse(readFileSync(join(dir, file), 'utf8'))
    } catch (e) {
      errors.push({ file, message: `invalid JSON: ${(e as Error).message}` })
      continue
    }
    const result = checkDefinition(file, data)
    if (typeof result === 'string') errors.push({ file, message: result })
    else games.push(result)
  }

  games.sort((a, b) => a.name.localeCompare(b.name))
  return { games, errors }
}
