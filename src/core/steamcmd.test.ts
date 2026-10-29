import { describe, expect, it } from 'vitest'
import { appUpdateArgs, parseSteamCmdLine, runSteamCmd, steamCmdDownload, steamCmdExecutable } from './steamcmd'

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

  it('fails when SteamCMD exits without a success line', async () => {
    const [exe, args] = fake('process.exit(0)')
    const result = await runSteamCmd(exe, [...args], () => {})
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/without finishing/)
  })
})

describe('parseSteamCmdLine', () => {
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

  it('ignores other lines', () => {
    expect(parseSteamCmdLine('Loading Steam API...OK')).toBeNull()
    expect(parseSteamCmdLine('')).toBeNull()
  })
})
