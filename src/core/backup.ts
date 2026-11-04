import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { BackupInfo, BackupReason } from './types'

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
  // The final name only after tar finished: a half-written archive must never be listed as a backup.
  const partial = `${file}.partial`
  try {
    await tar(['-czf', partial, '-C', dirname(saveDir), basename(saveDir)])
    renameSync(partial, file)
  } finally {
    rmSync(partial, { force: true })
  }
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

/** Keeps the newest `keep` of each kind, so frequent stop copies never push out a manual or pre-update one. */
export function pruneBackups(backupsDir: string, keep: number): void {
  const seen = new Map<BackupReason, number>()
  for (const b of listBackups(backupsDir)) {
    const count = (seen.get(b.reason) ?? 0) + 1
    seen.set(b.reason, count)
    if (count > keep) rmSync(b.file, { force: true })
  }
}

/** Restores a backup over `saveDir`. The current world is moved aside, never deleted. */
export async function restoreBackup(file: string, saveDir: string): Promise<void> {
  const aside = `${saveDir}.before-restore-${stamp(new Date())}`
  const hadWorld = existsSync(saveDir)
  if (hadWorld) renameSync(saveDir, aside)
  mkdirSync(dirname(saveDir), { recursive: true })
  try {
    await tar(['-xzf', file, '-C', dirname(saveDir)])
  } catch (e) {
    rmSync(saveDir, { recursive: true, force: true })
    if (hadWorld) renameSync(aside, saveDir)
    throw e
  }
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
