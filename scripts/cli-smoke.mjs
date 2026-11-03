// End-to-end check of the packed CLI (npm run build:cli first): serve, create, remote access, pairing, roles, the
// activity log and MCP over stdio, as a user would run them. Used by CI on Linux and Windows.
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const tgz = readdirSync(join(root, 'dist')).find((f) => /^neledport-\d.*\.tgz$/.test(f))
if (!tgz) throw new Error('dist/neledport-<version>.tgz is missing: run npm run build:cli')
const prefix = mkdtempSync(join(tmpdir(), 'neledport-smoke-'))
const shell = process.platform === 'win32'

// What a user types: npx on the tarball.
const npxVersion = execFileSync('npx', ['--yes', '--package', join(root, 'dist', tgz), 'neledport', '--version'], { cwd: prefix, encoding: 'utf8', shell }).trim()
console.log('npx neledport --version:', npxVersion)
execFileSync('npm', ['install', '--prefix', prefix, join(root, 'dist', tgz)], { stdio: 'ignore', shell })
const bin = join(prefix, 'node_modules', 'neledport', 'dist', 'neledport.mjs')
const env = { ...process.env, NELEDPORT_DATA: join(prefix, 'data'), NELEDPORT_SERVERS: join(prefix, 'servers') }

function cli(args, extraEnv = {}) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [bin, ...args], { env: { ...env, ...extraEnv }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  } catch (e) {
    return { code: e.status, out: `${e.stdout}${e.stderr}` }
  }
}
function expect(what, ok, detail) {
  if (!ok) throw new Error(`${what} failed:\n${detail}`)
  console.log('ok:', what)
}

const serve = spawn(process.execPath, [bin, 'serve'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''
serve.stdout.on('data', (d) => (log += d))
serve.stderr.on('data', (d) => (log += d))
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`serve did not start:\n${log}`)), 30_000)
    const check = setInterval(() => {
      if (log.includes('is hosting game servers')) clearInterval(check), clearTimeout(timer), resolve()
    }, 200)
  })
  expect('serve starts', true)
  expect('a second serve refuses to start', cli(['serve']).out.includes('already running'), log)

  let r = cli(['games', 'valheim'])
  expect('games lists the catalog', r.code === 0 && r.out.includes('valheim'), r.out)
  r = cli(['create', 'valheim', 'Smoke', 'Test', '--set', 'serverName=Smoke', '--set', 'password=smoke123'])
  expect('create', r.code === 0 && r.out.includes('Created Smoke Test'), r.out)

  r = cli(['remote', 'on', '--host', '127.0.0.1', '--port', '0', '--json'])
  const port = JSON.parse(r.out).listening
  expect('remote on', r.code === 0 && port > 0, r.out)
  const viewer = JSON.parse(cli(['devices', 'add', 'CI viewer', '--role', 'view', '--json']).out).code
  const controller = JSON.parse(cli(['devices', 'add', 'CI controller', '--role', 'control', '--json']).out).code
  const machine = ['--machine', `127.0.0.1:${port}`]

  r = cli(['list', ...machine], { NELEDPORT_CODE: viewer })
  expect('a paired viewer sees the servers', r.code === 0 && r.out.includes('Smoke Test'), r.out)
  r = cli(['status', ...machine, '--json'], { NELEDPORT_CODE: viewer })
  expect('a viewer sees the machine', r.code === 0 && JSON.parse(r.out).cpu.cores > 0, r.out)
  r = cli(['start', 'Smoke Test', ...machine], { NELEDPORT_CODE: viewer })
  expect('a viewer cannot start a server', r.code === 1 && r.out.includes('not allowed'), r.out)
  r = cli(['start', 'Smoke Test', ...machine], { NELEDPORT_CODE: controller })
  expect('a controller reaches the server (not installed yet)', r.code === 1 && /Install the server first/i.test(r.out), r.out)
  r = cli(['remove', 'Smoke Test', ...machine], { NELEDPORT_CODE: controller })
  expect('a controller cannot remove a server', r.code === 1 && r.out.includes('not allowed'), r.out)
  // A different key character in the middle (the last one carries padding bits).
  const i = viewer.length - 10
  r = cli(['list', ...machine], { NELEDPORT_CODE: viewer.slice(0, i) + (viewer[i] === 'A' ? 'B' : 'A') + viewer.slice(i + 1) })
  expect('a wrong code is refused', r.code === 1 && r.out.includes('refused'), r.out)
  r = cli(['activity'])
  expect('the activity log has the refusals', r.out.includes('CI viewer') && r.out.includes('servers.start') && r.out.includes('unknown'), r.out)

  const mcp = spawn(process.execPath, [bin, 'mcp'], { env, stdio: ['pipe', 'pipe', 'pipe'] })
  let mcpOut = ''
  mcp.stdout.on('data', (d) => (mcpOut += d))
  const send = (m) => mcp.stdin.write(JSON.stringify(m) + '\n')
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } } })
  send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_servers', arguments: {} } })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`MCP gave no answer:\n${mcpOut}`)), 20_000)
    const check = setInterval(() => {
      if (mcpOut.includes('"id":2')) clearInterval(check), clearTimeout(timer), resolve()
    }, 200)
  })
  mcp.stdin.end()
  expect('MCP lists the servers', mcpOut.includes('Smoke Test') && !mcpOut.includes('"isError":true'), mcpOut)

  r = cli(['remove', 'Smoke Test'])
  expect('the owner removes a server', r.code === 0, r.out)
} finally {
  serve.kill('SIGTERM')
}
await new Promise((resolve) => (serve.exitCode !== null ? resolve() : serve.once('exit', resolve)))
console.log('CLI smoke test passed')
