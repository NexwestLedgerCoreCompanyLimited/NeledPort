// Builds the neledport CLI package into out/cli and packs it as dist/neledport-<version>.tgz, which goes to npm and
// to each GitHub release (also as neledport.tgz): npm install -g <release URL>
import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { thirdPartyLicenses } from './notices.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'out', 'cli')
const app = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

execFileSync(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', 'vite.cli.config.mts'], { cwd: root, stdio: 'inherit' })
cpSync(join(root, 'games'), join(out, 'games'), { recursive: true })
copyFileSync(join(root, 'LICENSE'), join(out, 'LICENSE'))
copyFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), join(out, 'THIRD_PARTY_NOTICES.md'))
writeFileSync(join(out, 'THIRD_PARTY_LICENSES.txt'), thirdPartyLicenses(root))
writeFileSync(
  join(out, 'package.json'),
  JSON.stringify(
    {
      name: 'neledport',
      version: app.version,
      description: 'Host Steam dedicated game servers without a screen, watch them from another PC, and let an AI run them over MCP.',
      license: app.license,
      homepage: app.homepage,
      repository: app.repository,
      type: 'module',
      bin: { neledport: 'dist/neledport.mjs' },
      files: ['dist', 'games', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_LICENSES.txt'],
      engines: { node: '>=20.10' },
      keywords: ['game-server', 'steamcmd', 'dedicated-server', 'mcp', 'valheim', 'palworld', 'rust', 'ark']
    },
    null,
    2
  ) + '\n'
)
writeFileSync(
  join(out, 'README.md'),
  `# neledport\n\nThe command-line side of [NeledPort](${app.homepage}): host Steam dedicated game servers on a Linux or Windows\nserver without a screen, pair the NeledPort app on your PC to watch and control them, and let an AI run them over MCP.\n\n\`\`\`bash\nnpx neledport serve\n\`\`\`\n\nRun \`neledport help\` for every command. See the main README for remote access and MCP setup.\n`
)
mkdirSync(join(root, 'dist'), { recursive: true })
execFileSync(npm, ['pack', '--pack-destination', join(root, 'dist')], { cwd: out, stdio: 'inherit', shell: process.platform === 'win32' })
// The same file under a fixed name, so releases/latest/download/neledport.tgz always points at the newest one.
copyFileSync(join(root, 'dist', `neledport-${app.version}.tgz`), join(root, 'dist', 'neledport.tgz'))
