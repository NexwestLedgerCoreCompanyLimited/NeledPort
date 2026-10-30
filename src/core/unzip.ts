import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, posix, win32 } from 'node:path'
import { gunzipSync, inflateRawSync } from 'node:zlib'

export interface ZipEntry {
  path: string
  data: Buffer
}

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50

/** Reads every file in a zip (stored or deflate). shortcut: no Zip64, so archives must stay under 4 GB. */
export function readZip(buf: Buffer): ZipEntry[] {
  let end = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      end = i
      break
    }
  }
  if (end < 0) throw new Error('not a zip file')
  const count = buf.readUInt16LE(end + 10)
  let at = buf.readUInt32LE(end + 16)
  const entries: ZipEntry[] = []
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(at) !== CENTRAL) throw new Error('not a zip file (bad central directory)')
    const method = buf.readUInt16LE(at + 10)
    const size = buf.readUInt32LE(at + 20)
    const nameLen = buf.readUInt16LE(at + 28)
    const extraLen = buf.readUInt16LE(at + 30)
    const commentLen = buf.readUInt16LE(at + 32)
    const local = buf.readUInt32LE(at + 42)
    const path = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8').replace(/\\/g, '/')
    at += 46 + nameLen + extraLen + commentLen
    if (path.endsWith('/')) continue
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const raw = buf.subarray(start, start + size)
    if (method !== 0 && method !== 8) throw new Error(`${path}: unsupported compression method ${method}`)
    entries.push({ path, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) })
  }
  return entries
}

/**
 * Reads every file in a .tar.gz (ustar, GNU and pax headers). Folders are skipped; links are refused because they could
 * point outside the server folder. shortcut: whole archive in memory, fine for mod loaders (tens of MB).
 */
export function readTarGz(buf: Buffer): ZipEntry[] {
  const tar = gunzipSync(buf)
  const entries: ZipEntry[] = []
  let longName: string | undefined
  for (let at = 0; at + 512 <= tar.length; ) {
    const header = tar.subarray(at, at + 512)
    if (header.every((b) => b === 0)) break
    const field = (start: number, length: number) => header.subarray(start, start + length).toString('utf8').replace(/\0[\s\S]*$/, '')
    const size = parseInt(field(124, 12).trim() || '0', 8)
    const type = field(156, 1) || '0'
    const body = tar.subarray(at + 512, at + 512 + size)
    at += 512 + Math.ceil(size / 512) * 512
    if (type === 'L') {
      longName = body.toString('utf8').replace(/\0[\s\S]*$/, '')
      continue
    }
    if (type === 'x' || type === 'g') {
      longName = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString('utf8'))?.[1] ?? longName
      continue
    }
    // Only POSIX ustar has a name prefix there; GNU tar keeps other data in that spot.
    const prefix = field(257, 6) === 'ustar' ? field(345, 155) : ''
    const name = longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100))
    longName = undefined
    if (type === '5') continue
    if (type !== '0' && type !== '7') throw new Error(`Archive contains a link or special file: ${name}`)
    entries.push({ path: name.replace(/\\/g, '/').replace(/^\.\//, ''), data: Buffer.from(body) })
  }
  return entries
}

/** A .zip or a .tar.gz, told apart by their first bytes. */
export function readArchive(buf: Buffer): ZipEntry[] {
  return buf[0] === 0x1f && buf[1] === 0x8b ? readTarGz(buf) : readZip(buf)
}

function unsafe(path: string): boolean {
  return posix.isAbsolute(path) || win32.isAbsolute(path) || /^[A-Za-z]:/.test(path) || path.split(/[\\/]/).includes('..')
}

/**
 * Extracts into `dir` and returns the written paths (relative, with /). Every entry is checked before
 * anything is written, so a malicious archive cannot leave half its files behind.
 */
export function extractArchive(buf: Buffer, dir: string, o: { stripTopFolder?: string } = {}): string[] {
  const prefix = o.stripTopFolder ? `${o.stripTopFolder}/` : ''
  const entries = readArchive(buf)
  const bad = entries.find((e) => unsafe(e.path))
  if (bad) throw new Error(`Archive contains an unsafe path: ${bad.path}`)
  const files = entries.filter((e) => e.path.startsWith(prefix)).map((e) => ({ ...e, path: e.path.slice(prefix.length) }))
  for (const f of files) {
    const target = join(dir, f.path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, f.data)
  }
  return files.map((f) => f.path)
}
