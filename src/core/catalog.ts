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
  const paths = def.saveDir ? [def.saveDir] : []
  for (const platform of Object.values(def.platforms)) {
    if (!platform) continue
    paths.push(platform.executable, ...(platform.configFiles ?? []).map((c) => c.path))
  }
  return paths
}

function undeclaredReferences(def: GameDefinition): string[] {
  const known = new Set([
    'installDir',
    ...def.ports.map((p) => `port:${p.name}`),
    ...(def.settings ?? []).map((s) => `setting:${s.key}`)
  ])
  const used = Object.values(def.platforms).flatMap((p) =>
    p ? [...p.args, ...Object.values(p.env ?? {})].flatMap(placeholders) : []
  )
  if (def.control?.rest) used.push(`port:${def.control.rest.port}`)
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
  const undeclared = undeclaredReferences(data)
  if (undeclared.length) return `undeclared port or setting: ${undeclared.join(', ')}`
  return data
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
