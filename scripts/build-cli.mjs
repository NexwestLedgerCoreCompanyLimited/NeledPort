// Builds the neledport CLI package into out/cli and packs it as dist/neledport-<version>.tgz, which each GitHub
// release carries (also as neledport.tgz): npx --yes --package <release URL> neledport serve
import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'out', 'cli')
const app = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

execFileSync(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', 'vite.cli.config.mts'], { cwd: root, stdio: 'inherit' })
cpSync(join(root, 'games'), join(out, 'games'), { recursive: true })
copyFileSync(join(root, 'LICENSE'), join(out, 'LICENSE'))
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
      files: ['dist', 'games', 'README.md', 'LICENSE'],
      engines: { node: '>=20.10' },
      keywords: ['game-server', 'steamcmd', 'dedicated-server', 'mcp', 'valheim', 'palworld', 'rust', 'ark']
    },
    null,
    2
  ) + '\n'
)
writeFileSync(
  join(out, 'README.md'),
  `# neledport\n\nThe command-line side of [NeledPort](${app.homepage}): host Steam dedicated game servers on a Linux or Windows\nserver without a screen, pair the NeledPort app on your PC to watch and control them, and let an AI run them over MCP.\n\n\`\`\`bash\nnpx --yes --package ${app.homepage}/releases/download/v${app.version}/neledport.tgz neledport serve\n\`\`\`\n\nRun \`neledport help\` for every command. See the main README for remote access and MCP setup.\n`
)
mkdirSync(join(root, 'dist'), { recursive: true })
execFileSync(npm, ['pack', '--pack-destination', join(root, 'dist')], { cwd: out, stdio: 'inherit', shell: process.platform === 'win32' })
// The same file under a fixed name, so release links need only the tag (and releases/latest works from 1.0, when
// releases stop being pre-releases).
copyFileSync(join(root, 'dist', `neledport-${app.version}.tgz`), join(root, 'dist', 'neledport.tgz'))
