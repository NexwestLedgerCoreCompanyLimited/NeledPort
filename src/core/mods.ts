import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { ModLoaderDefinition, Platform, PluginInfo } from './types'
import { extractZip, readZip } from './unzip'

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

/** Where a loader download may end up after redirects: GitHub and Thunderstore and their file CDNs. */
export function allowedDownloadHost(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url)
    return (
      protocol === 'https:' &&
      (['github.com', 'thunderstore.io'].includes(hostname) || hostname.endsWith('.githubusercontent.com') || hostname.endsWith('.thunderstore.io'))
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
  const url = loader.download[platform]
  if (!url) throw new Error(`${loader.name} has no ${platform} build`)
  // Download and read everything before touching the server, so a failure leaves it as it was.
  const buf = await download(url)
  const prefix = loader.stripTopFolder ? `${loader.stripTopFolder}/` : ''
  const paths = readZip(buf)
    .map((e) => e.path)
    .filter((p) => p.startsWith(prefix))
    .map((p) => p.slice(prefix.length))
  const previous = loaderState(installDir, loader.id)
  const ownFiles = new Set(previous?.added ?? [])
  const replaced = paths.filter((p) => !ownFiles.has(p) && existsSync(join(installDir, p)))
  const added = paths.filter((p) => !replaced.includes(p))
  extractZip(buf, installDir, { stripTopFolder: loader.stripTopFolder })
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
}

export function addPlugin(installDir: string, loader: ModLoaderDefinition, source: string): void {
  const name = basename(source)
  checkName(loader, name)
  const dir = join(installDir, loader.pluginDir)
  mkdirSync(dir, { recursive: true })
  copyFileSync(source, join(dir, name))
}

export function removePlugin(installDir: string, loader: ModLoaderDefinition, name: string): void {
  checkName(loader, name)
  rmSync(join(installDir, loader.pluginDir, name), { force: true })
  rmSync(join(disabledDir(installDir, loader), name), { force: true })
}
