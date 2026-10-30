import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const OURS = /^\s*(?:hostname|rcon_password)\b/i

// A quote ends the value and a line break starts a new command; either would let a name run other commands.
const clean = (value: string) => value.replace(/"/g, '').replace(/[\r\n]+/g, ' ')

/**
 * Sets hostname and rcon_password in a Source server's config (the one +servercfgfile runs on every map), keeping
 * every other line. On the command line srcds_run splits a name with spaces into separate words.
 */
export function writeSourceConfig(file: string, o: { hostname: string; rconPassword: string }): void {
  const lines = existsSync(file)
    ? readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .filter((l) => !OURS.test(l))
    : ['// NeledPort sets hostname and rcon_password here on every start; the rest is yours.']
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  lines.push(`hostname "${clean(o.hostname)}"`, `rcon_password "${clean(o.rconPassword)}"`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, lines.join('\n') + '\n')
}
