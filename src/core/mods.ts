import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, posix } from 'node:path'
import type { ModLoaderDefinition, Platform, PluginInfo } from './types'
import { extractArchive, readArchive } from './unzip'

export interface LoaderState {
  id: string
  installedAt: string
  /** Files the loader brought (removed on uninstall). */
  added: string[]
  /** Game files it overwrote (restored with SteamCMD validate on uninstall). */
  replaced: string[]
}


const MAX_DOWNLOAD_BYTES = 300 * 1024 * 1024
const stateDir = (installDir: string) => join(installDir, '.neledport')
const stateFile = (installDir: string, id: string) => join(stateDir(installDir), `loader-${id}.json`)
const disabledDir = (installDir: string, loader: ModLoaderDefinition) => join(stateDir(installDir), 'disabled-plugins', loader.id)

/** Where a loader download may end up after redirects: GitHub, Thunderstore, their file CDNs, and AlliedModders' build servers. */
export function allowedDownloadHost(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url)
    return (
      protocol === 'https:' &&
      (['github.com', 'thunderstore.io', 'sm.alliedmods.net', 'mms.alliedmods.net', 'www.amxmodx.org'].includes(hostname) ||
        hostname.endsWith('.githubusercontent.com') ||
        hostname.endsWith('.thunderstore.io'))
    )
  } catch {
    return false
  }
}

export async function downloadZip(url: string): Promise<Buffer> {
  if (!allowedDownloadHost(url)) throw new Error(`Refusing to download from ${url}`)
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(180_000) })
  if (!allowedDownloadHost(res.url)) throw new Error(`Download was redirected to an untrusted host: ${new URL(res.url).hostname}`)
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
  const size = Number(res.headers.get('content-length') ?? 0)
  if (size > MAX_DOWNLOAD_BYTES) throw new Error('Download is too large')
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_DOWNLOAD_BYTES) throw new Error('Download is too large')
  return buf
}

export function loaderState(installDir: string, id: string): LoaderState | null {
  const file = stateFile(installDir, id)
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as LoaderState) : null
}

export async function installLoader(
  installDir: string,
  loader: ModLoaderDefinition,
  platform: Platform,
  download: (url: string) => Promise<Buffer> = downloadZip
): Promise<LoaderState> {
  const urls = [loader.download[platform] ?? []].flat()
  if (!urls.length) throw new Error(`${loader.name} has no ${platform} build`)
  // Download and read everything before touching the server, so a failure leaves it as it was.
  const archives: Buffer[] = []
  // With latestFile, a URL without an archive extension is a "-latest-" file naming the build; others are archives.
  for (const url of urls) archives.push(await download(loader.latestFile && !ARCHIVE.test(url) ? await latestBuild(url, download) : url))
  const prefix = loader.stripTopFolder ? `${loader.stripTopFolder}/` : ''
  const target = loader.installTo ? join(installDir, loader.installTo) : installDir
  const paths = archives.flatMap((buf) =>
    readArchive(buf)
      .map((e) => e.path)
      .filter((p) => p.startsWith(prefix))
      .map((p) => posix.join(loader.installTo ?? '', p.slice(prefix.length)))
  )
  paths.push(...(loader.setup ?? []).map((s) => s.file))
  const previous = loaderState(installDir, loader.id)
  const ownFiles = new Set(previous?.added ?? [])
  const replaced = paths.filter((p) => !ownFiles.has(p) && existsSync(join(installDir, p)))
  const added = paths.filter((p) => !replaced.includes(p))
  for (const buf of archives) extractArchive(buf, target, { stripTopFolder: loader.stripTopFolder })
  for (const step of loader.setup ?? []) applySetup(join(installDir, step.file), step)
  const state: LoaderState = {
    id: loader.id,
    installedAt: new Date().toISOString(),
    added,
    replaced: [...new Set([...(previous?.replaced ?? []), ...replaced])]
  }
  mkdirSync(stateDir(installDir), { recursive: true })
  writeFileSync(stateFile(installDir, loader.id), JSON.stringify(state, null, 2))
  return state
}

const ARCHIVE = /\.(?:zip|tar\.gz)$/

/** Rewrites `key value` lines (keeping the file's line endings and other lines) or writes the whole file. */
function applySetup(file: string, step: NonNullable<ModLoaderDefinition['setup']>[number]): void {
  if (step.lines) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, step.lines.join('\n') + '\n')
  }
  if (step.set) {
    let text = existsSync(file) ? readFileSync(file, 'utf8') : ''
    const eol = text.includes('\r\n') ? '\r\n' : '\n'
    for (const [key, value] of Object.entries(step.set)) {
      const line = new RegExp(`^[ \\t]*${key.replace(/[^\w]/g, '\\$&')}[ \\t].*$`, 'm')
      text = line.test(text) ? text.replace(line, `${key} ${value}`) : `${text}${text && !text.endsWith(eol) ? eol : ''}${key} ${value}${eol}`
    }
    writeFileSync(file, text)
  }
}

/** AlliedModders' "-latest-" file holds only the archive name; it must stay a plain name in the same folder. */
async function latestBuild(url: string, download: (url: string) => Promise<Buffer>): Promise<string> {
  const name = (await download(url)).toString('utf8').trim()
  if (!/^[\w.+-]+\.(?:zip|tar\.gz)$/.test(name)) throw new Error(`Unexpected latest build name from ${url}: ${name.slice(0, 80)}`)
  return new URL(name, url).href
}

export function uninstallLoader(installDir: string, id: string): { needsValidate: boolean } {
  const state = loaderState(installDir, id)
  if (!state) return { needsValidate: false }
  for (const p of state.added) rmSync(join(installDir, p), { force: true })
  rmSync(stateFile(installDir, id), { force: true })
  return { needsValidate: state.replaced.length > 0 }
}

// A plugin name is a bare file name with one of the loader's extensions; anything else could escape the folder.
function checkName(loader: ModLoaderDefinition, name: string): void {
  if (!name || name !== basename(name) || /[\\/]/.test(name) || name.startsWith('.')) throw new Error(`Invalid plugin name: ${name}`)
  if (!loader.pluginExtensions.includes(extname(name).toLowerCase())) {
    throw new Error(`Plugins for ${loader.name} must end in ${loader.pluginExtensions.join(' or ')}`)
  }
}

const filesIn = (dir: string, loader: ModLoaderDefinition) =>
  existsSync(dir) ? readdirSync(dir).filter((n) => loader.pluginExtensions.includes(extname(n).toLowerCase())) : []

export function listPlugins(installDir: string, loader: ModLoaderDefinition): PluginInfo[] {
  const on = join(installDir, loader.pluginDir)
  const off = disabledDir(installDir, loader)
  return [
    ...filesIn(on, loader).map((name) => ({ name, enabled: true, size: statSync(join(on, name)).size })),
    ...filesIn(off, loader).map((name) => ({ name, enabled: false, size: statSync(join(off, name)).size }))
  ].sort((a, b) => a.name.localeCompare(b.name))
}

export function setPluginEnabled(installDir: string, loader: ModLoaderDefinition, name: string, enabled: boolean): void {
  checkName(loader, name)
  const on = join(installDir, loader.pluginDir)
  const off = disabledDir(installDir, loader)
  const [from, to] = enabled ? [off, on] : [on, off]
  if (!existsSync(join(from, name))) return
  mkdirSync(to, { recursive: true })
  renameSync(join(from, name), join(to, name))
  listPlugin(installDir, loader, name, enabled ? 'on' : 'off')
}

/** AMX Mod X loads only the plugins named in its plugins.ini: list, comment out (;name) or drop the plugin's line. */
function listPlugin(installDir: string, loader: ModLoaderDefinition, name: string, state: 'on' | 'off' | 'gone'): void {
  if (!loader.pluginList) return
  const file = join(installDir, loader.pluginList)
  const lines = existsSync(file) ? readFileSync(file, 'utf8').replace(/\r?\n$/, '').split(/\r?\n/) : []
  const at = lines.findIndex((l) => l.trim().replace(/^;\s*/, '').split(/\s/)[0] === name)
  const line = state === 'on' ? name : `;${name}`
  if (state === 'gone') {
    if (at >= 0) lines.splice(at, 1)
  } else if (at >= 0) lines[at] = line
  else lines.push(line)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, lines.join('\n') + '\n')
}

export function addPlugin(installDir: string, loader: ModLoaderDefinition, source: string): void {
  const name = basename(source)
  checkName(loader, name)
  const dir = join(installDir, loader.pluginDir)
  mkdirSync(dir, { recursive: true })
  copyFileSync(source, join(dir, name))
  listPlugin(installDir, loader, name, 'on')
}

export function removePlugin(installDir: string, loader: ModLoaderDefinition, name: string): void {
  checkName(loader, name)
  rmSync(join(installDir, loader.pluginDir, name), { force: true })
  rmSync(join(disabledDir(installDir, loader), name), { force: true })
  listPlugin(installDir, loader, name, 'gone')
}
