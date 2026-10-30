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

/** One game-server child process: output, state, graceful stop with a forced fallback. */
export class ServerProcess extends EventEmitter {
  state: ProcessState = 'stopped'
  lastExitCode: number | null = null
  private child?: ChildProcess
  private buffer: string[] = []
  private exited?: Promise<void>

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

  /** Ctrl+C equivalent. Returns false where it is not possible (Windows). */
  interrupt(): boolean {
    if (!this.child?.pid || IS_WINDOWS) return false
    process.kill(-this.child.pid, 'SIGINT')
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
      new Promise<boolean>((r) => setTimeout(() => r(true), o.timeoutMs))
    ])
    if (!timedOut) return { forced: false }
    this.addLine(
      o.timeoutMs > 0
        ? '[NeledPort] The server did not stop in time and was forced to quit.'
        : '[NeledPort] This server cannot be asked to save on this system. Closing the server now.'
    )
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
