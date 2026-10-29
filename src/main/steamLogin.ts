import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'

// Each takes the program and its arguments after the given flag.
const TERMINALS: [string, string[]][] = [
  ['x-terminal-emulator', ['-e']],
  ['gnome-terminal', ['--']],
  ['konsole', ['-e']],
  ['xfce4-terminal', ['-x']],
  ['xterm', ['-e']]
]

const onPath = (cmd: string) => (process.env.PATH ?? '').split(delimiter).some((dir) => dir && existsSync(join(dir, cmd)))

/**
 * Opens SteamCMD in its own window so the password and Steam Guard code are typed into Valve's tool, never into
 * NeledPort. SteamCMD then remembers the login. `user` must already have passed isSteamUser.
 */
export function openSteamLogin(exe: string, user: string): void {
  if (process.platform === 'win32') {
    // `start` gives SteamCMD a console of its own to type into; Windows paths cannot contain the quote.
    spawn(`start "Steam sign-in" "${exe}" +login ${user}`, { shell: true, cwd: dirname(exe), windowsHide: true, stdio: 'ignore' })
    return
  }
  const term = TERMINALS.find(([cmd]) => onPath(cmd))
  if (!term) throw new Error(`No terminal app found. Run this in a terminal, then press Check: "${exe}" +login ${user}`)
  spawn(term[0], [...term[1], exe, '+login', user], { cwd: dirname(exe), detached: true, stdio: 'ignore' })
    .on('error', (e) => console.error('[NeledPort] could not open the Steam sign-in window:', e.message))
    .unref()
}
