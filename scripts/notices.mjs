// Writes THIRD_PARTY_LICENSES.txt: the licence of every package the installers and the CLI bundle, as their licences
// require. Usage: node scripts/notices.mjs <output file>
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Development dependencies by npm's reckoning, but compiled into the window the app ships.
const BUNDLED_IN_RENDERER = ['react', 'react-dom', 'scheduler', 'tailwindcss']

export function thirdPartyLicenses(root) {
  const { packages } = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
  const shipped = Object.entries(packages)
    .filter(([path, p]) => path && (!p.dev || BUNDLED_IN_RENDERER.some((name) => path === `node_modules/${name}`)))
    .sort(([a], [b]) => a.localeCompare(b))
  return shipped
    .map(([path, p]) => {
      const dir = join(root, path)
      const file = existsSync(dir) ? readdirSync(dir).find((f) => /^(licen[cs]e|copying)/i.test(f)) : undefined
      const text = file ? readFileSync(join(dir, file), 'utf8').trim() : `No licence file in the package; its package.json says: ${p.license ?? 'unknown'}`
      return `${path.replace(/^.*node_modules\//, '')} ${p.version} (${p.license ?? 'unknown'})\n\n${text}\n`
    })
    .join(`\n${'-'.repeat(78)}\n\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = process.argv[2]
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, thirdPartyLicenses(join(dirname(fileURLToPath(import.meta.url)), '..')))
}
