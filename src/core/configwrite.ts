import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

// A line break would start another setting of the caller's choosing.
const clean = (value: string) => value.replace(/[\r\n]+/g, ' ')
const escape = (key: string) => key.replace(/[^\w]/g, '\\$&')

/**
 * Sets values in a game's own config file, keeping every other line and the file's line endings: INI keys inside a
 * [section], plain key=value lines, "key value" lines, or "key: value" lines (SCP:SL). Used on every start for the RCON password, ports and name.
 */
export function writeConfigValues(file: string, o: { section?: string; style?: 'equals' | 'space' | 'colon'; values: Record<string, string> }): void {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text ? text.replace(/\r?\n$/, '').split(/\r?\n/) : []
  const sep = o.style === 'space' ? ' ' : o.style === 'colon' ? ': ' : '='
  let start = 0
  let end = lines.length
  if (o.section) {
    const header = lines.findIndex((l) => l.trim() === `[${o.section}]`)
    if (header < 0) {
      lines.push(`[${o.section}]`)
      start = end = lines.length
    } else {
      start = header + 1
      const next = lines.findIndex((l, i) => i >= start && /^\s*\[.*\]\s*$/.test(l))
      end = next < 0 ? lines.length : next
    }
  }
  for (const [key, value] of Object.entries(o.values)) {
    const match = new RegExp(`^\\s*${escape(key)}${o.style === 'space' ? '\\s' : o.style === 'colon' ? '\\s*:' : '\\s*='}`, 'i')
    const at = lines.findIndex((l, i) => i >= start && i < end && match.test(l))
    const line = `${key}${sep}${clean(value)}`
    if (at >= 0) lines[at] = line
    else lines.splice(end++, 0, line)
  }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, lines.join(eol) + eol)
}
