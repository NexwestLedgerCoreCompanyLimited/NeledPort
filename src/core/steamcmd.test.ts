import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appUpdateArgs, captureSteamCmd, isSteamUser, parseSignedIn, parseSteamCmdLine, runSteamCmd, steamCmdDownload, steamCmdExecutable } from './steamcmd'

describe('steamCmdDownload', () => {
  it('uses the official Valve archives', () => {
    expect(steamCmdDownload('windows')).toEqual({
      url: 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip',
      archive: 'steamcmd.zip'
    })
    expect(steamCmdDownload('linux').url).toBe('https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz')
  })
})

describe('steamCmdExecutable', () => {
  it('points at the platform launcher', () => {
    expect(steamCmdExecutable('/x', 'linux')).toMatch(/steamcmd\.sh$/)
    expect(steamCmdExecutable('C:\\x', 'windows')).toMatch(/steamcmd\.exe$/)
  })
})

describe('appUpdateArgs', () => {
  it('sets the install dir before logging in', () => {
    const args = appUpdateArgs({ installDir: '/srv/pal', appId: 2394010, validate: false })
    expect(args).toEqual(['+force_install_dir', '/srv/pal', '+login', 'anonymous', '+app_update', '2394010', '+quit'])
  })

  it('adds validate when asked', () => {
    const args = appUpdateArgs({ installDir: '/srv/pal', appId: 2394010, validate: true })
    expect(args.slice(-3)).toEqual(['2394010', 'validate', '+quit'])
  })

  // HLDS (app 90) holds several games; app_set_config picks which one SteamCMD downloads (WindowsGSM does the same).
  it('chooses the Half-Life mod before updating', () => {
    const args = appUpdateArgs({ installDir: '/srv/dod', appId: 90, validate: false, mod: 'dod' })
    expect(args).toEqual(['+force_install_dir', '/srv/dod', '+login', 'anonymous', '+app_set_config', '90', 'mod', 'dod', '+app_update', '90', '+quit'])
  })

  // HumanitZ ships its Linux server only on the "linuxbranch" beta (LinuxGSM installs it the same way).
  it('downloads a beta branch when the game needs one', () => {
    const args = appUpdateArgs({ installDir: '/srv/hz', appId: 2728330, validate: true, branch: 'linuxbranch' })
    expect(args.slice(-6)).toEqual(['+app_update', '2728330', '-beta', 'linuxbranch', 'validate', '+quit'])
  })

  it('logs in with the Steam account when the game needs one', () => {
    const args = appUpdateArgs({ installDir: '/srv/arma', appId: 233780, validate: false, login: 'gamer_1' })
    expect(args).toEqual(['+force_install_dir', '/srv/arma', '+login', 'gamer_1', '+app_update', '233780', '+quit'])
  })
})

describe('isSteamUser', () => {
  it('accepts Steam account names', () => {
    expect(isSteamUser('gamer_1')).toBe(true)
    expect(isSteamUser('ABC')).toBe(true)
  })

  it('rejects anything SteamCMD could read as a command or an extra argument', () => {
    for (const bad of ['', 'ab', '+quit', 'a b', 'a;b', '../x', 'x'.repeat(65), 7, null]) expect(isSteamUser(bad), String(bad)).toBe(false)
  })
})

describe('parseSignedIn', () => {
  it('is true once SteamCMD gets past the login to the user info', () => {
    const out = "Logging in user 'gamer_1' [U:1:123] to Steam Public...OK\nWaiting for client config...OK\nWaiting for user info...OK\n"
    expect(parseSignedIn(out)).toBe(true)
  })

  it('is false when the login failed or SteamCMD wants a password', () => {
    expect(parseSignedIn("Logging in user 'gamer_1' to Steam Public...FAILED (Invalid Password)")).toBe(false)
    expect(parseSignedIn("Logging in user 'gamer_1' to Steam Public...\npassword: ")).toBe(false)
    expect(parseSignedIn('')).toBe(false)
  })
})

describe('runSteamCmd', () => {
  const fake = (script: string) => [process.execPath, ['-e', script]] as const

  it('succeeds only after the success line', async () => {
    const [exe, args] = fake(`console.log(" Update state (0x61) downloading, progress: 50.00 (1 / 2)\\rSuccess! App '1' fully installed.")`)
    const lines: string[] = []
    expect(await runSteamCmd(exe, [...args], (l) => lines.push(l))).toEqual({ ok: true })
    expect(lines).toContain(" Update state (0x61) downloading, progress: 50.00 (1 / 2)")
  })

  it('fails with the SteamCMD error line', async () => {
    const [exe, args] = fake(`console.log("ERROR! Failed to install app '1' (No subscription)"); process.exit(8)`)
    expect(await runSteamCmd(exe, [...args], () => {})).toEqual({
      ok: false,
      error: "ERROR! Failed to install app '1' (No subscription)"
    })
  })

  it('never waits for typed input, so an expired Steam login cannot hang an install', async () => {
    const [exe, args] = fake(`process.stdin.on('end', () => { console.log('ERROR! no input'); process.exit(5) }).resume()`)
    expect(await runSteamCmd(exe, [...args], () => {})).toEqual({ ok: false, error: 'ERROR! no input' })
  }, 10_000)

  it('stops SteamCMD when asked to', async () => {
    const [exe, args] = fake('setInterval(() => {}, 1000)')
    const abort = new AbortController()
    setTimeout(() => abort.abort(), 100)
    const result = await runSteamCmd(exe, [...args], () => {}, abort.signal)
    expect(result.ok).toBe(false)
  }, 10_000)

  // steamcmd.sh runs the real SteamCMD as its child: stopping only the script would leave SteamCMD running.
  it.skipIf(process.platform === 'win32')('stops the programs SteamCMD started too', async () => {
    const pidFile = join(mkdtempSync(join(tmpdir(), 'steamcmd-')), 'child.pid')
    const script = `const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); setInterval(() => {}, 1000)`
    const abort = new AbortController()
    const run = runSteamCmd(process.execPath, ['-e', script], () => {}, abort.signal)
    while (!existsSync(pidFile)) await new Promise((r) => setTimeout(r, 50))
    abort.abort()
    expect((await run).ok).toBe(false)
    await new Promise((r) => setTimeout(r, 300))
    const alive = (pid: number) => {
      try {
        return process.kill(pid, 0)
      } catch {
        return false
      }
    }
    expect(alive(Number(readFileSync(pidFile, 'utf8')))).toBe(false)
  }, 10_000)

  it('fails when SteamCMD exits without a success line', async () => {
    const [exe, args] = fake('process.exit(0)')
    const result = await runSteamCmd(exe, [...args], () => {})
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/without finishing/)
  })
})

describe('parseSteamCmdLine', () => {
  it('reports a failed Steam login as an error', () => {
    const line = "Logging in user 'gamer_1' to Steam Public...FAILED (Invalid Password)"
    expect(parseSteamCmdLine(line)).toEqual({ kind: 'error', message: line })
  })

  it('reads download progress', () => {
    expect(parseSteamCmdLine(' Update state (0x61) downloading, progress: 63.92 (2147483648 / 3359666176)')).toEqual({
      kind: 'progress',
      percent: 63.92
    })
    expect(parseSteamCmdLine(' Update state (0x101) committing, progress: 99.10 (100 / 101)')).toEqual({
      kind: 'progress',
      percent: 99.1
    })
  })

  it('reads success', () => {
    expect(parseSteamCmdLine("Success! App '2394010' fully installed.")).toEqual({ kind: 'success' })
  })

  it('reads errors', () => {
    expect(parseSteamCmdLine("ERROR! Failed to install app '2394010' (Disk write failure)")).toEqual({
      kind: 'error',
      message: "ERROR! Failed to install app '2394010' (Disk write failure)"
    })
  })

  it('ignores the ANSI colour codes SteamCMD prints on Linux', () => {
    expect(parseSteamCmdLine("\x1b[0mSuccess! App '896660' fully installed.")).toEqual({ kind: 'success' })
    expect(parseSteamCmdLine('\x1b[0mERROR! Failed to install app')).toEqual({ kind: 'error', message: 'ERROR! Failed to install app' })
  })

  it('ignores other lines', () => {
    expect(parseSteamCmdLine('Loading Steam API...OK')).toBeNull()
    expect(parseSteamCmdLine('')).toBeNull()
  })
})

describe('captureSteamCmd', () => {
  const fake = (script: string) => [process.execPath, ['-e', script]] as const

  it('returns what SteamCMD printed, with no input to wait for', async () => {
    const [exe, args] = fake(`process.stdin.on('end', () => console.log('no input')).resume()`)
    expect(await captureSteamCmd(exe, [...args])).toContain('no input')
  }, 10_000)

  it('stops a SteamCMD that keeps waiting', async () => {
    const [exe, args] = fake(`console.log('waiting'); setInterval(() => {}, 1000)`)
    const started = Date.now()
    expect(await captureSteamCmd(exe, [...args], 500)).toContain('waiting')
    expect(Date.now() - started).toBeLessThan(5000)
  }, 10_000)
})
