import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { request } from 'node:https'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { e2e, e2eManager, platform, retry } from './harness'

// Real end-to-end run of Satisfactory: claim the server and start a game as a player would through the server API,
// then let NeledPort save and shut it down with the claim password. See .github/e2e-games.json.
function api(port: number, fn: string, data: object, token?: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ function: fn, data })
    const req = request(
      { host: '127.0.0.1', port, path: '/api/v1', method: 'POST', rejectUnauthorized: false, timeout: 30_000,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } },
      (res) => {
        let text = ''
        res.on('data', (c) => (text += c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : undefined }))
      }
    )
    req.on('timeout', () => req.destroy(new Error('timed out')))
    req.on('error', reject)
    req.end(body)
  })
}

describe.skipIf(!e2e || platform !== 'linux')('satisfactory on Linux, end to end', () => {
  it('saves and shuts down through the server API with the claim password', { timeout: 60 * 60_000 }, async () => {
    const manager = e2eManager(mkdtempSync(join(tmpdir(), 'neledport-e2e-')))
    const password = 'neledport-e2e-claim'
    const { id } = manager.create({ gameId: 'satisfactory', name: 'NeledPort E2E', settings: { serverAdminPassword: password } })
    await manager.install(id)
    await manager.start(id)
    const port = manager.get(id).ports.game

    const initial = await retry(
      manager,
      id,
      async () => {
        const r = await api(port, 'PasswordlessLogin', { MinimumPrivilegeLevel: 'InitialAdmin' })
        if (r.status !== 200) throw new Error(`PasswordlessLogin answered ${r.status}`)
        return r.body.data.authenticationToken as string
      },
      20 * 60_000
    )
    const claim = await api(port, 'ClaimServer', { ServerName: 'NeledPort E2E', AdminPassword: password }, initial)
    expect(claim.status).toBe(200)
    const admin = claim.body.data.authenticationToken as string
    console.log('CreateNewGame:', (await api(port, 'CreateNewGame', { NewGameData: { SessionName: 'NeledPortE2E' } }, admin)).status)
    await retry(
      manager,
      id,
      async () => {
        const state = (await api(port, 'QueryServerState', {}, admin)).body?.data?.serverGameState
        if (state?.activeSessionName !== 'NeledPortE2E') throw new Error(`session: ${JSON.stringify(state)}`)
      },
      10 * 60_000
    )
    console.log('RunCommand through NeledPort:', await manager.command(id, 'FG.AutosaveInterval'))

    const { forced } = await manager.stop(id)
    expect(forced).toBe(false)
    expect(manager.lines(id).join('\n')).not.toMatch(/sending Ctrl\+C instead/)
    const saves = execFileSync('find', [join(homedir(), '.config/Epic/FactoryGame/Saved/SaveGames'), '-name', '*.sav'], { encoding: 'utf8' })
    console.log('saves:\n' + saves)
    expect(saves).toMatch(/NeledPortE2E_neledport\.sav/)
  })
})
