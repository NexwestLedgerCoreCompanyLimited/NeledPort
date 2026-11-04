import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { EventEmitter } from 'node:events'
import { lineReader } from './lines'
import type { ProcessState } from './types'

export type { ProcessState }

export interface LaunchSpec {
  command: string
  args: string[]
  cwd: string
  env?: Record<string, string>
}


const MAX_LOG_BYTES = 5 * 1024 * 1024
const IS_WINDOWS = process.platform === 'win32'

// Node cannot send Ctrl+C on Windows: this joins the server's hidden console and raises it there, ignoring it itself.
const windowsCtrlC = (pid: number) => `
Add-Type -Namespace NeledPort -Name Console -MemberDefinition '
[DllImport("kernel32.dll")] public static extern bool FreeConsole();
[DllImport("kernel32.dll")] public static extern bool AttachConsole(uint pid);
[DllImport("kernel32.dll")] public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
[DllImport("kernel32.dll")] public static extern bool GenerateConsoleCtrlEvent(uint ctrlEvent, uint group);'
[void][NeledPort.Console]::FreeConsole()
if (-not [NeledPort.Console]::AttachConsole(${pid})) { exit 1 }
[void][NeledPort.Console]::SetConsoleCtrlHandler([IntPtr]::Zero, $true)
if (-not [NeledPort.Console]::GenerateConsoleCtrlEvent(0, 0)) { exit 2 }
Start-Sleep -Milliseconds 500
`

/** One game-server child process: output, state, graceful stop with a forced fallback. */
export class ServerProcess extends EventEmitter {
  state: ProcessState = 'stopped'
  lastExitCode: number | null = null
  private child?: ChildProcess
  private buffer: string[] = []
  private exited?: Promise<void>
  private giveUp?: () => void

  /** `hide`: secrets (the RCON password) that must never reach the console or the log file. HLDS echoes RCON commands. */
  constructor(private opts: { logFile?: string; maxLines?: number; readyPattern?: RegExp; hide?: string[] } = {}) {
    super()
  }

  get pid(): number | undefined {
    return this.child?.pid
  }

  lines(): string[] {
    return [...this.buffer]
  }

  start(spec: LaunchSpec): void {
    if (this.child) throw new Error('server is already running')
    this.rotateLog()
    this.setState('starting')
    // Own process group on POSIX so signals reach the real server behind wrapper scripts like PalServer.sh.
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      detached: !IS_WINDOWS,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.child = child
    const reader = lineReader((line) => this.addLine(line))
    child.stdout?.on('data', reader.push)
    child.stderr?.on('data', reader.push)
    child.on('spawn', () => {
      if (!this.opts.readyPattern) this.setState('running')
    })
    this.exited = new Promise((resolve) => {
      child.on('error', (e) => this.addLine(`[NeledPort] Could not start the server: ${e.message}`))
      child.on('close', (code, signal) => {
        reader.flush()
        this.child = undefined
        this.lastExitCode = code
        const expected = this.state === 'stopping' || (code === 0 && signal === null)
        this.setState(expected ? 'stopped' : 'crashed')
        this.emit('exit', code, signal)
        resolve()
      })
    })
  }

  /** Sends a line to the server's console (stdin). */
  write(text: string): void {
    this.child?.stdin?.write(text + '\n')
  }

  /** Ctrl+C. On Windows a helper delivers it through the server's console, and a server without one is given up on. */
  interrupt(): boolean {
    if (!this.child?.pid) return false
    if (!IS_WINDOWS) {
      process.kill(-this.child.pid, 'SIGINT')
      return true
    }
    const helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(windowsCtrlC(this.child.pid), 'utf16le').toString('base64')], {
      windowsHide: true,
      stdio: 'ignore'
    })
    const failed = () => {
      this.addLine('[NeledPort] This server has no console to send Ctrl+C to.')
      this.giveUp?.()
    }
    helper.on('error', failed)
    helper.on('close', (code) => code !== 0 && failed())
    return true
  }

  async stop(o: { graceful?: () => unknown; timeoutMs: number }): Promise<{ forced: boolean }> {
    if (!this.child || !this.exited) return { forced: false }
    const exited = this.exited
    this.setState('stopping')
    try {
      await o.graceful?.()
    } catch (e) {
      this.addLine(`[NeledPort] Graceful stop failed: ${(e as Error).message}`)
    }
    const timedOut = await Promise.race([
      exited.then(() => false),
      new Promise<boolean>((r) => {
        setTimeout(() => r(true), o.timeoutMs)
        this.giveUp = () => r(true)
      })
    ])
    if (!timedOut) return { forced: false }
    this.addLine('[NeledPort] The server did not stop in time and was forced to quit.')
    this.killTree()
    await exited
    return { forced: true }
  }

  private killTree(): void {
    const pid = this.child?.pid
    if (!pid) return
    if (IS_WINDOWS) spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    else {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        this.child?.kill('SIGKILL')
      }
    }
  }

  private addLine(raw: string): void {
    const line = (this.opts.hide ?? []).filter(Boolean).reduce((text, secret) => text.split(secret).join('********'), raw)
    this.buffer.push(line)
    const max = this.opts.maxLines ?? 2000
    if (this.buffer.length > max) this.buffer.splice(0, this.buffer.length - max)
    if (this.opts.logFile) appendFileSync(this.opts.logFile, line + '\n')
    this.emit('line', line)
    if (this.state === 'starting' && this.opts.readyPattern?.test(line)) this.setState('running')
  }

  private rotateLog(): void {
    const file = this.opts.logFile
    if (!file) return
    mkdirSync(dirname(file), { recursive: true })
    if (existsSync(file) && statSync(file).size > MAX_LOG_BYTES) renameSync(file, file + '.1')
  }

  private setState(state: ProcessState): void {
    if (this.state === state) return
    this.state = state
    this.emit('state', state)
  }
}
