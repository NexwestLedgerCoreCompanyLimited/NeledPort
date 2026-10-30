import { describe, expect, it } from 'vitest'
import { satisfactoryApi, type ApiPost } from './satisfactory'

// Stands in for the server's /api/v1: records each call and answers like the Dedicated Server API docs.
function fakeServer(o: { password?: string; session?: string } = {}) {
  const calls: string[] = []
  const post: ApiPost = async (fn, data, token) => {
    calls.push(`${fn}${token ? ` as ${token}` : ''}`)
    if (fn === 'PasswordLogin') {
      if ((data as { Password: string }).Password !== o.password) return { status: 401, body: { errorCode: 'wrong_password', errorMessage: 'Wrong password' } }
      return { status: 200, body: { data: { authenticationToken: 'admin-token' } } }
    }
    if (fn === 'PasswordlessLogin') {
      if (o.password) return { status: 401, body: { errorCode: 'passwordless_login_not_possible' } }
      return { status: 200, body: { data: { authenticationToken: 'initial-token' } } }
    }
    if (fn === 'QueryServerState') return { status: 200, body: { data: { serverGameState: { activeSessionName: o.session ?? '', numConnectedPlayers: 0 } } } }
    if (fn === 'RunCommand') return { status: 200, body: { data: { commandResult: `ran ${(data as { Command: string }).Command}` } } }
    return { status: 204, body: undefined }
  }
  return { calls, post }
}

describe('satisfactoryApi', () => {
  it('logs in with the admin password, saves the running session, then shuts down', async () => {
    const s = fakeServer({ password: 'pw', session: 'Home' })
    await satisfactoryApi({ port: 7777, password: 'pw', post: s.post }).saveAndShutdown()
    expect(s.calls).toEqual(['PasswordLogin', 'QueryServerState as admin-token', 'SaveGame as admin-token', 'Shutdown as admin-token'])
  })

  it('logs in without a password while nobody has claimed the server', async () => {
    const s = fakeServer({ session: 'Home' })
    await satisfactoryApi({ port: 7777, post: s.post }).saveAndShutdown()
    expect(s.calls[0]).toBe('PasswordlessLogin')
    expect(s.calls.at(-1)).toBe('Shutdown as initial-token')
  })

  it('does not ask for a save when no game is loaded', async () => {
    const s = fakeServer()
    await satisfactoryApi({ port: 7777, post: s.post }).saveAndShutdown()
    expect(s.calls).toEqual(['PasswordlessLogin', 'QueryServerState as initial-token', 'Shutdown as initial-token'])
  })

  it("passes on the server's own error", async () => {
    const s = fakeServer({ password: 'pw' })
    await expect(satisfactoryApi({ port: 7777, password: 'nope', post: s.post }).saveAndShutdown()).rejects.toThrow(/Wrong password/)
  })

  it('runs console commands', async () => {
    const s = fakeServer({ password: 'pw' })
    expect(await satisfactoryApi({ port: 7777, password: 'pw', post: s.post }).command('FG.AutosaveInterval')).toBe('ran FG.AutosaveInterval')
  })
})
