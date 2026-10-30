// Prints the GitHub Release text for a version: its CHANGELOG.md section plus a link to every change.
// Usage: node scripts/release-notes.mjs 0.7.0 > notes.md
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function releaseNotes(changelog, version) {
  const lines = changelog.split('\n')
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`))
  // The section ends at the next version heading, or at the link list after the oldest one.
  const end = lines.findIndex((l, i) => i > start && (l.startsWith('## [') || /^\[[^\]]+\]: /.test(l)))
  const body = start < 0 ? '' : lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim()
  if (!/^- /m.test(body)) throw new Error(`No CHANGELOG notes for ${version}: add a "## [${version}]" section first`)
  const link = lines.find((l) => l.startsWith(`[${version}]: `))?.slice(version.length + 4)
  return `${body}\n${link ? `\n**Full changelog:** ${link}\n` : ''}`
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const version = (process.argv[2] ?? '').replace(/^v/, '')
  process.stdout.write(releaseNotes(readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8'), version))
}
