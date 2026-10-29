import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { adminFor, LogPlayerTracker, type AdminNet } from './admin'
import { loadCatalog } from './catalog'
import type { GameDefinition } from './types'

const base = loadCatalog(join(__dirname, '../../games')).games
const game = (id: string) => base.find((g) => g.id === id)!
const dir = () => mkdtempSync(join(tmpdir(), 'admin-'))

function recorder() {
  const calls: string[] = []
  const net: AdminNet = {
    rcon: async (o, cmd) => (calls.push(`rcon:${o.port}:${cmd}`), cmd === 'status' ? 'ok' : ''),
    webrcon: async (o, cmd) => {
      calls.push(`web:${o.port}:${cmd}`)
      return cmd === 'playerlist' ? JSON.stringify([{ SteamID: '7656001', DisplayName: 'Mira', Ping: 31, ConnectedSeconds: 600 }]) : ''
    },
    a2s: async () => [{ name: 'Rook', score: 4, seconds: 90 }],
    rest: () => ({
      players: async () => ({ players: [{ name: 'Ploy', userId: 'steam_7656002', ping: 22.6 }] }),
      kick: async (id: string) => void calls.push(`kick:${id}`),
      ban: async (id: string, msg: string) => void calls.push(`ban:${id}:${msg}`),
      unban: async (id: string) => void calls.push(`unban:${id}`),
      announce: async (msg: string) => void calls.push(`announce:${msg}`),
      save: async () => void calls.push('save')
    })
  }
  return { calls, net }
}

describe('Palworld admin (REST)', () => {
  it('lists, kicks and bans through the REST API', async () => {
    const { calls, net } = recorder()
    const admin = adminFor({ game: game('palworld'), installDir: dir(), ports: { rest: 8212, game: 8211, query: 27015 }, adminPassword: 'a', net })
    expect(await admin.players()).toEqual([{ id: 'steam_7656002', name: 'Ploy', ping: 23 }])
    await admin.kick!({ id: 'steam_7656002', name: 'Ploy' }, 'afk')
    await admin.ban!({ id: 'steam_7656002', name: 'Ploy' }, 'griefing')
    expect(calls).toEqual(['kick:steam_7656002', 'ban:steam_7656002:griefing'])
  })

  it('maps console commands to the REST API', async () => {
    const { calls, net } = recorder()
    const admin = adminFor({ game: game('palworld'), installDir: dir(), ports: { rest: 8212 }, adminPassword: 'a', net })
    await admin.command!('say Restart in 5 minutes')
    await admin.command!('save')
    await expect(admin.command!('give Mira 100')).rejects.toThrow(/say <message>/)
    expect(calls).toEqual(['announce:Restart in 5 minutes', 'save'])
  })

  it('reads the ban list file', async () => {
    const d = dir()
    mkdirSync(join(d, 'Pal/Saved/SaveGames'), { recursive: true })
    writeFileSync(join(d, 'Pal/Saved/SaveGames/banlist.txt'), 'steam_1\n\nsteam_2\n')
    const admin = adminFor({ game: game('palworld'), installDir: d, ports: { rest: 8212 }, adminPassword: 'a', net: recorder().net })
    expect(await admin.bans!()).toEqual([{ id: 'steam_1' }, { id: 'steam_2' }])
  })
})

describe('Rust admin (WebRCON)', () => {
  it('lists players from playerlist JSON', async () => {
    const { net } = recorder()
    const admin = adminFor({ game: game('rust'), installDir: dir(), ports: { rcon: 28016 }, adminPassword: 'pw', net })
    expect(await admin.players()).toEqual([{ id: '7656001', name: 'Mira', ping: 31, seconds: 600 }])
  })

  it('quotes names and reasons safely and saves the ban list', async () => {
    const { calls, net } = recorder()
    const admin = adminFor({ game: game('rust'), installDir: dir(), ports: { rcon: 28016 }, adminPassword: 'pw', net })
    await admin.ban!({ id: '7656001', name: 'Mi"ra\n' }, 'grief "x"')
    expect(calls).toEqual(['web:28016:banid 7656001 "Mira" "grief x"', 'web:28016:server.writecfg'])
  })

  it('reads bans.cfg', async () => {
    const d = dir()
    mkdirSync(join(d, 'server/neledport/cfg'), { recursive: true })
    writeFileSync(join(d, 'server/neledport/cfg/bans.cfg'), 'banid 7656001 "Mira" "grief" -1\nbanid 7656003 "Rook" "" -1\n')
    const admin = adminFor({ game: game('rust'), installDir: d, ports: { rcon: 28016 }, adminPassword: 'pw', net: recorder().net })
    expect(await admin.bans!()).toEqual([
      { id: '7656001', name: 'Mira', reason: 'grief' },
      { id: '7656003', name: 'Rook', reason: '' }
    ])
  })
})

describe('Valheim admin (log + ban file)', () => {
  it('tracks players from the server log', () => {
    const g = game('valheim')
    const t = new LogPlayerTracker(g.logPatterns!)
    t.feed('Got connection SteamID 7656001')
    t.feed('Got character ZDOID from Mira : -123:1')
    t.feed('Got connection SteamID 7656002')
    t.feed('Closing socket 7656002')
    expect(t.players().map((p) => ({ id: p.id, name: p.name }))).toEqual([{ id: '7656001', name: 'Mira' }])
  })

  it('bans and unbans through bannedlist.txt, keeping comments', async () => {
    const d = dir()
    const admin = adminFor({ game: game('valheim'), installDir: d, ports: {}, adminPassword: 'a', tracker: new LogPlayerTracker({}), net: recorder().net })
    expect(admin.kick).toBeUndefined()
    await admin.ban!({ id: '7656001', name: 'Mira' }, '')
    const file = join(d, 'saves', 'bannedlist.txt')
    expect(existsSync(file)).toBe(true)
    writeFileSync(file, '// List banned players ID  ONE per line\n' + readFileSync(file, 'utf8') + '7656009\n')
    expect(await admin.bans!()).toEqual([{ id: '7656001' }, { id: '7656009' }])
    await admin.unban!('7656001')
    expect(readFileSync(file, 'utf8')).toBe('// List banned players ID  ONE per line\n7656009\n')
  })
})

describe('Counter-Strike 2 admin (RCON + A2S)', () => {
  it('lists players by query and kicks by quoted name', async () => {
    const { calls, net } = recorder()
    const admin = adminFor({ game: game('cs2'), installDir: dir(), ports: { game: 27015 }, adminPassword: 'pw', net })
    expect(await admin.players()).toEqual([{ id: 'Rook', name: 'Rook', seconds: 90 }])
    await admin.kick!({ id: 'Rook', name: 'Ro"ok' }, '')
    expect(calls).toEqual(['rcon:27015:kick "Rook"'])
    expect(await admin.command!('status')).toBe('ok')
    expect(admin.bans).toBeUndefined()
  })
})

describe('games without remote control', () => {
  it('gives no player list when the definition has no source', async () => {
    const plain: GameDefinition = { ...game('valheim'), players: undefined, bans: undefined, logPatterns: {} }
    const admin = adminFor({ game: plain, installDir: dir(), ports: {}, adminPassword: 'a', net: recorder().net })
    await expect(admin.players()).rejects.toThrow(/not available/)
  })
})
