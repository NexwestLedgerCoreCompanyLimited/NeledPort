import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { lineReader, stripAnsi } from './lines'
import type { Platform } from './types'

const VALVE_INSTALLER = 'https://steamcdn-a.akamaihd.net/client/installer/'

export function steamCmdDownload(platform: Platform): { url: string; archive: string } {
  const archive = platform === 'windows' ? 'steamcmd.zip' : 'steamcmd_linux.tar.gz'
  return { url: VALVE_INSTALLER + archive, archive }
}

export function steamCmdExecutable(dir: string, platform: Platform): string {
  return join(dir, platform === 'windows' ? 'steamcmd.exe' : 'steamcmd.sh')
}

/** Steam account names: letters, digits and underscores. Anything else could be read by SteamCMD as a command. */
export const isSteamUser = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_]{3,64}$/.test(value)

/** True when SteamCMD logged in with its saved session (it prints this only after a successful login). */
export const parseSignedIn = (output: string): boolean => /Waiting for user info\.\.\.OK/.test(output)

export function appUpdateArgs(o: { installDir: string; appId: number; validate: boolean; login?: string }): string[] {
  // force_install_dir must come before login or SteamCMD ignores it.
  return [
    '+force_install_dir',
    o.installDir,
    '+login',
    o.login ?? 'anonymous',
    '+app_update',
    String(o.appId),
    ...(o.validate ? ['validate'] : []),
    '+quit'
  ]
}

export type SteamCmdEvent = { kind: 'progress'; percent: number } | { kind: 'success' } | { kind: 'error'; message: string }

export function parseSteamCmdLine(line: string): SteamCmdEvent | null {
  const text = stripAnsi(line).trim()
  const progress = /Update state \(0x[0-9a-f]+\) [\w ]+, progress: (\d+(?:\.\d+)?)/i.exec(text)
  if (progress) return { kind: 'progress', percent: Number(progress[1]) }
  if (/^Success! App '\d+' fully installed/.test(text)) return { kind: 'success' }
  if (/^ERROR!/.test(text) || /^Logging in user .*FAILED/.test(text)) return { kind: 'error', message: text }
  return null
}

/** Downloads and unpacks SteamCMD into `dir` unless it is already there. Returns the launcher path. */
export async function ensureSteamCmd(dir: string, platform: Platform): Promise<string> {
  const exe = steamCmdExecutable(dir, platform)
  if (existsSync(exe)) return exe
  mkdirSync(dir, { recursive: true })
  const { url, archive } = steamCmdDownload(platform)
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!res.ok || !res.body) throw new Error(`SteamCMD download failed: HTTP ${res.status}`)
  const file = join(dir, archive)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file))
  // Linux tar and Windows 10+ bsdtar (tar.exe) both unpack .tar.gz and .zip.
  await run('tar', ['-xf', file, '-C', dir])
  rmSync(file, { force: true })
  if (!existsSync(exe)) throw new Error('SteamCMD archive did not contain the launcher')
  return exe
}

export function runSteamCmd(
  exe: string,
  args: string[],
  onLine: (line: string) => void
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    let success = false
    let error: string | undefined
    const reader = lineReader((line) => {
      onLine(line)
      const event = parseSteamCmdLine(line)
      if (event?.kind === 'success') success = true
      if (event?.kind === 'error') error = event.message
    })
    const child = spawn(exe, args, { cwd: dirname(exe), windowsHide: true })
    // No one can type here: a login prompt (expired Steam session) must fail, not wait forever.
    child.stdin.end()
    child.stdout.on('data', reader.push)
    child.stderr.on('data', reader.push)
    child.on('error', (e) => resolve({ ok: false, error: e.message }))
    child.on('close', (code) => {
      reader.flush()
      if (success && !error) resolve({ ok: true })
      else resolve({ ok: false, error: error ?? `SteamCMD exited with code ${code} without finishing the install` })
    })
  })
}

/** Runs SteamCMD and returns everything it printed (app_info_print, login checks). Gives up after `timeoutMs`. */
export function captureSteamCmd(exe: string, args: string[], timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = ''
    const child = spawn(exe, args, { cwd: dirname(exe), windowsHide: true })
    child.stdin.end()
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    child.on('error', (e) => (clearTimeout(timer), reject(e)))
    child.on('close', () => (clearTimeout(timer), resolve(stripAnsi(out))))
  })
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true })
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`))))
  })
}
