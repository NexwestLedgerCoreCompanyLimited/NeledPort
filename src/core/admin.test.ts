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

// Source engine games (srcds): TF2, Counter-Strike: Source, Garry's Mod, Left 4 Dead 2, ...
const sourceGame: GameDefinition = {
  id: 'tf-like',
  name: 'TF2-like',
  serverAppId: 232250,
  anonymous: true,
  tier: 'full',
  platforms: { linux: { executable: 'srcds_run_64', args: [] } },
  ports: [{ name: 'game', default: 27015, protocol: 'udp' }],
  control: { type: 'rcon', port: 'game', shutdown: 'quit' },
  players: { source: 'rcon' },
  bans: { method: 'rcon', file: 'tf/cfg/banned_user.cfg', format: 'source-cfg' }
}

const TF2_STATUS = `hostname: NeledPort
version : 9233375/24 9233375 secure
players : 2 humans, 1 bots (24 max)
# userid name                uniqueid            connected ping loss state  adr
#      2 "Mira"              [U:1:12345]         01:02:03    45    0 active 203.0.113.9:27005
#      3 "Rook "the" Bold"   [U:1:67890]         00:42       80    0 active 198.51.100.7:27005
#      4 "Bot01"             BOT                             active
`
// CS:GO-era builds put the slot after the userid; Left 4 Dead adds the rate.
const OTHER_STATUS = `# userid name uniqueid connected ping loss state rate adr
# 5 1 "Ploy" STEAM_1:0:4242 00:31 50 0 active 128000 192.0.2.1:27005
#  6 "Kai" STEAM_0:1:777 10:05 20 0 active 30000 192.0.2.2:27005
`

describe('Source engine admin (RCON)', () => {
  function source(status: string) {
    const calls: string[] = []
    const net: AdminNet = { rcon: async (o, cmd) => (calls.push(`rcon:${o.port}:${cmd}`), cmd === 'status' ? status : '') }
    return { calls, admin: adminFor({ game: sourceGame, installDir: dir(), ports: { game: 27015 }, adminPassword: 'pw', net }) }
  }

  it('lists players from status with their SteamIDs, skipping bots', async () => {
    expect(await source(TF2_STATUS).admin.players()).toEqual([
      { id: '[U:1:12345]', name: 'Mira', ping: 45, seconds: 3723 },
      { id: '[U:1:67890]', name: 'Rook "the" Bold', ping: 80, seconds: 42 }
    ])
    expect(await source(OTHER_STATUS).admin.players()).toEqual([
      { id: 'STEAM_1:0:4242', name: 'Ploy', ping: 50, seconds: 31 },
      { id: 'STEAM_0:1:777', name: 'Kai', ping: 20, seconds: 605 }
    ])
  })

  it('kicks and bans by quoted SteamID, keeps colons out of the reason, and saves the ban list', async () => {
    const { calls, admin } = source('')
    await admin.kick!({ id: '[U:1:12345]', name: 'Mira' }, 'spam: "links"')
    await admin.kick!({ id: 'STEAM_0:1:777', name: 'Kai' }, '')
    await admin.ban!({ id: 'STEAM_0:1:777', name: 'Kai' }, 'grief')
    await admin.unban!('[U:1:12345]')
    expect(calls).toEqual([
      'rcon:27015:kickid "[U:1:12345]" "spam links"',
      'rcon:27015:kickid "STEAM_0:1:777"',
      'rcon:27015:banid 0 "STEAM_0:1:777" kick',
      'rcon:27015:writeid',
      'rcon:27015:removeid "[U:1:12345]"',
      'rcon:27015:writeid'
    ])
  })

  it('reads banned_user.cfg as written by writeid', async () => {
    const d = dir()
    mkdirSync(join(d, 'tf/cfg'), { recursive: true })
    writeFileSync(join(d, 'tf/cfg/banned_user.cfg'), 'banid 0 STEAM_0:1:777\nbanid 0.000000 [U:1:12345]\n\n')
    const admin = adminFor({ game: sourceGame, installDir: d, ports: { game: 27015 }, adminPassword: 'pw', net: {} })
    expect(await admin.bans!()).toEqual([{ id: 'STEAM_0:1:777' }, { id: '[U:1:12345]' }])
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
