import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { networkInterfaces, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { e2e, platform } from './harness'

// The Linux-server story with the packed CLI (npm run build:cli first) and a real Counter-Strike 1.6 server:
// install from the command line, start it with `serve --start` as systemd would after a reboot, control it from
// another "machine" over the runner's network address, then SIGTERM saves and stops it. See .github/workflows/e2e.yml.
const bin = join(__dirname, '../../out/cli/dist/neledport.mjs')
const root = mkdtempSync(join(tmpdir(), 'neledport-cli-e2e-'))
const env = { ...process.env, NELEDPORT_DATA: join(root, 'data'), NELEDPORT_SERVERS: join(root, 'servers') }
const name = 'CLI E2E'

function cli(args: string[], extraEnv: Record<string, string> = {}, timeout = 120_000): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [bin, ...args], { env: { ...env, ...extraEnv }, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 })
    return { code: 0, out }
  } catch (e) {
    const err = e as { status: number; stdout?: string; stderr?: string }
    return { code: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

function serve(args: string[] = []): { proc: ChildProcess; log: () => string; exited: Promise<number | null> } {
  let log = ''
  const proc = spawn(process.execPath, [bin, 'serve', ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  proc.stdout!.on('data', (d) => (log += d))
  proc.stderr!.on('data', (d) => (log += d))
  const exited = new Promise<number | null>((resolve) => proc.once('exit', (code) => resolve(code)))
  return { proc, log: () => log, exited }
}

async function until<T>(what: string, fn: () => T | undefined, timeoutMs: number, detail: () => string): Promise<T> {
  const end = Date.now() + timeoutMs
  for (;;) {
    const value = fn()
    if (value !== undefined) return value
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}:\n${detail()}`)
    await new Promise((r) => setTimeout(r, 3000))
  }
}

const status = () => {
  const r = cli(['list', '--json'])
  return r.code === 0 ? (JSON.parse(r.out) as { name: string; status: string }[]).find((s) => s.name === name)?.status : undefined
}

describe.skipIf(!e2e || platform !== 'linux')('neledport CLI on a Linux server, end to end', () => {
  it('installs, starts with serve --start, is controlled over the network and stops on SIGTERM', { timeout: 45 * 60_000 }, async () => {
    expect(existsSync(bin)).toBe(true)
    let host = serve()
    await until('serve', () => (host.log().includes('is hosting game servers') ? true : undefined), 30_000, host.log)

    let r = cli(['create', 'counter-strike-1-6', name, '--set', `serverName=${name}`])
    expect(r.out).toContain(`Created ${name}`)
    r = cli(['install', name], {}, 30 * 60_000)
    console.log(r.out.slice(-500))
    expect(r.code).toBe(0)
    expect(status()).toBe('stopped')

    // A reboot: systemd stops serve with SIGTERM and starts it again with --start.
    host.proc.kill('SIGTERM')
    expect(await host.exited).toBe(0)
    host = serve(['--start', name])
    await until('the server to run', () => (status() === 'running' ? true : undefined), 5 * 60_000, host.log)

    // Another machine, through the runner's own network address rather than 127.0.0.1.
    const lan = Object.values(networkInterfaces())
      .flat()
      .find((a) => a && a.family === 'IPv4' && !a.internal)?.address
    expect(lan).toBeTruthy()
    const remote = JSON.parse(cli(['remote', 'on', '--host', '0.0.0.0', '--port', '0', '--json']).out) as { listening: number }
    const { code } = JSON.parse(cli(['devices', 'add', 'Office PC', '--role', 'control', '--json']).out) as { code: string }
    const machine = ['--machine', `${lan}:${remote.listening}`]
    const reply = await until(
      'RCON over the network',
      () => {
        const x = cli(['cmd', name, 'status', ...machine], { NELEDPORT_CODE: code })
        return x.code === 0 && /hostname:\s*CLI E2E/.test(x.out) ? x.out : undefined
      },
      3 * 60_000,
      host.log
    )
    console.log('status over the network:\n' + reply)
    r = cli(['players', name, ...machine], { NELEDPORT_CODE: code })
    expect(r.code).toBe(0)
    r = cli(['status', ...machine, '--json'], { NELEDPORT_CODE: code })
    expect(JSON.parse(r.out).servers).toEqual({ total: 1, running: 1 })
    expect(cli(['activity']).out).toContain('servers.command')

    // Shutdown: SIGTERM saves and stops every server, then serve exits cleanly and the game is gone.
    host.proc.kill('SIGTERM')
    expect(await host.exited).toBe(0)
    console.log(host.log().slice(-1500))
    expect(host.log()).toContain('Saving and stopping every server')
    expect(host.log()).toMatch(/CLI E2E: stopped/)
    expect(() => execFileSync('pgrep', ['-f', 'hlds_linux'])).toThrow()
  })
})
