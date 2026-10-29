import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

export type BackupReason = 'manual' | 'update' | 'scheduled' | 'config' | 'stop'

export interface BackupInfo {
  file: string
  reason: BackupReason
  createdAt: string
  size: number
}

const NAME = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)_([a-z]+)\.tar\.gz$/

function stamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-')
}

function fromStamp(s: string): string {
  const [day, time] = s.split('T')
  const [h, m, sec, ms] = time.replace('Z', '').split('-')
  return `${day}T${h}:${m}:${sec}.${ms}Z`
}

/** Archives `saveDir` into `backupsDir`. Returns null when there is no world to back up yet. */
export async function createBackup(saveDir: string, backupsDir: string, reason: BackupReason): Promise<BackupInfo | null> {
  if (!existsSync(saveDir)) return null
  mkdirSync(backupsDir, { recursive: true })
  const file = join(backupsDir, `${stamp(new Date())}_${reason}.tar.gz`)
  await tar(['-czf', file, '-C', dirname(saveDir), basename(saveDir)])
  return listBackups(backupsDir).find((b) => b.file === file) ?? null
}

/** Newest first. */
export function listBackups(backupsDir: string): BackupInfo[] {
  if (!existsSync(backupsDir)) return []
  return readdirSync(backupsDir)
    .map((name) => ({ name, match: NAME.exec(name) }))
    .filter((x) => x.match)
    .map(({ name, match }) => {
      const file = join(backupsDir, name)
      return { file, reason: match![2] as BackupReason, createdAt: fromStamp(match![1]), size: statSync(file).size }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function pruneBackups(backupsDir: string, keep: number): void {
  for (const old of listBackups(backupsDir).slice(keep)) rmSync(old.file, { force: true })
}

/** Restores a backup over `saveDir`. The current world is moved aside, never deleted. */
export async function restoreBackup(file: string, saveDir: string): Promise<void> {
  if (existsSync(saveDir)) renameSync(saveDir, `${saveDir}.before-restore-${stamp(new Date())}`)
  mkdirSync(dirname(saveDir), { recursive: true })
  await tar(['-xzf', file, '-C', dirname(saveDir)])
}

function tar(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = ''
    const child = spawn('tar', args, { windowsHide: true })
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`tar failed (${code}): ${stderr.trim()}`))))
  })
}
