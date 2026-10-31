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

  // Core Keeper names the player on the join line itself.
  it('takes the name from the join line when it has one', () => {
    const t = new LogPlayerTracker({ join: '\\[userid:(?<id>\\d+)\\] player (?<name>.+?) connected', leave: 'Disconnected from userid:(?<id>\\d+)' })
    t.feed('[userid:42] player Mira Bold connected islocalplayer=False')
    expect(t.players().map((p) => ({ id: p.id, name: p.name }))).toEqual([{ id: '42', name: 'Mira Bold' }])
    t.feed('Disconnected from userid:42 with reason Quit')
    expect(t.players()).toEqual([])
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

  // Seen on real CS:S and TF2 servers: a quoted ID is refused ("Can't ban users with ID"), an unquoted STEAM_ or [U:1:]
  // ID works, and writeid stores every ban as [U:1:N]. So IDs are checked strictly and sent unquoted as [U:1:N].
  it('bans and unbans by SteamID in the form the server stores, and saves the ban list', async () => {
    const { calls, admin } = source('')
    await admin.ban!({ id: 'STEAM_0:1:777', name: 'Kai' }, 'grief')
    await admin.ban!({ id: '76561198000000001', name: 'Pasted' }, '')
    await admin.unban!('[U:1:12345]')
    expect(calls).toEqual([
      'rcon:27015:banid 0 [U:1:1555] kick',
      'rcon:27015:writeid',
      'rcon:27015:banid 0 [U:1:39734273] kick',
      'rcon:27015:writeid',
      'rcon:27015:removeid [U:1:12345]',
      'rcon:27015:writeid'
    ])
  })

  it('refuses anything that is not a SteamID, since the ID goes unquoted into the command', async () => {
    const { calls, admin } = source('')
    await expect(admin.ban!({ id: '1; quit', name: 'x' }, '')).rejects.toThrow(/SteamID/)
    await expect(admin.unban!('[U:1:1] ; quit')).rejects.toThrow(/SteamID/)
    expect(calls).toEqual([])
  })

  it('kicks by the userid from status', async () => {
    const { calls, admin } = source(TF2_STATUS)
    await admin.kick!({ id: '[U:1:67890]', name: 'Rook' }, 'spam: "links"')
    expect(calls).toEqual(['rcon:27015:status', 'rcon:27015:kickid 3 "spam: links"'])
    await expect(admin.kick!({ id: '[U:1:5]', name: 'Gone' }, '')).rejects.toThrow(/not on the server/)
  })

  it('reads banned_user.cfg as written by writeid', async () => {
    const d = dir()
    mkdirSync(join(d, 'tf/cfg'), { recursive: true })
    writeFileSync(join(d, 'tf/cfg/banned_user.cfg'), 'banid 0 STEAM_0:1:777\nbanid 0.000000 [U:1:12345]\n\n')
    const admin = adminFor({ game: sourceGame, installDir: d, ports: { game: 27015 }, adminPassword: 'pw', net: {} })
    expect(await admin.bans!()).toEqual([{ id: 'STEAM_0:1:777' }, { id: '[U:1:12345]' }])
  })
})

// GoldSrc (Half-Life 1) games: Counter-Strike 1.6, Day of Defeat, Team Fortress Classic, ...
const goldGame: GameDefinition = {
  ...sourceGame,
  id: 'cs16-like',
  control: { type: 'goldsrc', port: 'game', shutdown: 'quit' },
  bans: { method: 'rcon', file: 'cstrike/banned.cfg', format: 'source-cfg' }
}

const GOLDSRC_STATUS = `hostname:  NeledPort CS
version :  48/1.1.2.7/Stdio 10211 secure  (10)
players :  3 active (16 max)

#      name userid uniqueid frag time ping loss adr
# 1 "Mira" 2 STEAM_0:1:12345   3 01:02:03   45    0 203.0.113.9:27005
# 2 "Rook "x"" 3 STEAM_0:0:67890  -1 00:42   80    0 198.51.100.7:27005
# 3 "Bot01" 4 BOT   0 00:10    0    0
3 users
`

describe('GoldSrc admin (UDP RCON)', () => {
  function gold(status: string) {
    const calls: string[] = []
    const net: AdminNet = { goldsrc: async (o, cmd) => (calls.push(`gold:${o.port}:${cmd}`), cmd === 'status' ? status : '') }
    return { calls, admin: adminFor({ game: goldGame, installDir: dir(), ports: { game: 27015 }, adminPassword: 'pw', net }) }
  }

  it('lists players from the GoldSrc status table, skipping bots', async () => {
    expect(await gold(GOLDSRC_STATUS).admin.players()).toEqual([
      { id: 'STEAM_0:1:12345', name: 'Mira', ping: 45, seconds: 3723 },
      { id: 'STEAM_0:0:67890', name: 'Rook "x"', ping: 80, seconds: 42 }
    ])
  })

  it('bans in the STEAM_0 form GoldSrc knows, and kicks by #userid', async () => {
    const { calls, admin } = gold(GOLDSRC_STATUS)
    await admin.ban!({ id: '[U:1:1555]', name: 'Kai' }, 'grief')
    await admin.ban!({ id: '76561198000000001', name: 'Pasted' }, '')
    await admin.unban!('STEAM_0:1:777')
    await admin.kick!({ id: 'STEAM_0:0:67890', name: 'Rook' }, 'spam')
    expect(calls).toEqual([
      'gold:27015:banid 0 STEAM_0:1:777 kick',
      'gold:27015:writeid',
      'gold:27015:banid 0 STEAM_0:1:19867136 kick',
      'gold:27015:writeid',
      'gold:27015:removeid STEAM_0:1:777',
      'gold:27015:writeid',
      'gold:27015:status',
      'gold:27015:kick #3 "spam"'
    ])
    await expect(admin.ban!({ id: 'STEAM_0:1:1 ; quit', name: 'x' }, '')).rejects.toThrow(/SteamID/)
  })

  it('reads banned.cfg as written by writeid', async () => {
    const d = dir()
    mkdirSync(join(d, 'cstrike'), { recursive: true })
    writeFileSync(join(d, 'cstrike/banned.cfg'), 'banid 0.0 STEAM_0:1:777\r\n')
    const admin = adminFor({ game: goldGame, installDir: d, ports: { game: 27015 }, adminPassword: 'pw', net: {} })
    expect(await admin.bans!()).toEqual([{ id: 'STEAM_0:1:777' }])
  })
})

// Games that speak Source RCON with their own commands (ARK, Squad, Mordhau...): the definition names the commands and
// a pattern for the player rows, so adding such a game needs no code.
const dataGame: GameDefinition = {
  ...sourceGame,
  id: 'ark-like',
  control: { type: 'rcon', port: 'rcon', save: 'SaveWorld', shutdown: 'DoExit' },
  players: { source: 'rcon', command: 'ListPlayers', pattern: '^\\d+\\. (?<name>.+), (?<id>\\d{17})\\s*$', kick: 'KickPlayer {id}' },
  bans: { method: 'rcon', ban: 'BanPlayer {id}', unban: 'UnbanPlayer {id}', file: 'Saved/BanList.txt', format: 'lines' }
}

describe('admin from data (RCON commands named by the definition)', () => {
  function data(listing: string) {
    const calls: string[] = []
    const net: AdminNet = { rcon: async (o, cmd) => (calls.push(`rcon:${o.port}:${cmd}`), cmd === 'ListPlayers' ? listing : '') }
    return { calls, admin: adminFor({ game: dataGame, installDir: dir(), ports: { rcon: 27020 }, adminPassword: 'pw', net }) }
  }

  it('lists players with the named command and pattern', async () => {
    expect(await data('0. Mira, 76561198000000001 \n1. Rook Bold, 76561198000000002\nNo Players Connected?').admin.players()).toEqual([
      { id: '76561198000000001', name: 'Mira' },
      { id: '76561198000000002', name: 'Rook Bold' }
    ])
  })

  it('kicks, bans and unbans with the named commands, refusing IDs that could add commands', async () => {
    const { calls, admin } = data('')
    await admin.kick!({ id: '76561198000000001', name: 'Mira' }, 'spam')
    await admin.ban!({ id: '76561198000000001', name: 'Mira' }, 'grief')
    await admin.unban!('76561198000000001')
    expect(calls).toEqual(['rcon:27020:KickPlayer 76561198000000001', 'rcon:27020:BanPlayer 76561198000000001', 'rcon:27020:UnbanPlayer 76561198000000001'])
    await expect(admin.ban!({ id: '7656 ; DoExit', name: 'x' }, '')).rejects.toThrow(/player ID/)
  })

  it('kicks by quoted name where the game lists players by query', async () => {
    const calls: string[] = []
    const net: AdminNet = { rcon: async (o, cmd) => (calls.push(cmd), ''), a2s: async () => [{ name: 'Rook Bold', score: 0, seconds: 5 }] }
    const byName: GameDefinition = { ...dataGame, players: { source: 'a2s', port: 'query', kick: 'kick "{name}" {reason}' } }
    const admin = adminFor({ game: byName, installDir: dir(), ports: { rcon: 27020, query: 27015 }, adminPassword: 'pw', net })
    await admin.kick!({ id: 'Rook Bold', name: 'Rook "Bold' }, 'afk')
    expect(calls).toEqual(['kick "Rook Bold" afk'])
  })

  it('reads a Squad-style Bans.cfg and unbans by taking the line out, then reloading', async () => {
    const installDir = dir()
    mkdirSync(join(installDir, 'ServerConfig'))
    writeFileSync(
      join(installDir, 'ServerConfig/Bans.cfg'),
      'Admin [SteamID 76561198000000009] Banned:76561198000000001:0 //grief\r\n76561198000000002:1767225600 //spam\n// note\n'
    )
    const calls: string[] = []
    const squadLike: GameDefinition = {
      ...dataGame,
      bans: { method: 'rcon', ban: 'AdminBan {id} 0 {reason}', file: 'ServerConfig/Bans.cfg', format: 'squad-cfg', save: 'AdminReloadServerConfig' }
    }
    const admin = adminFor({ game: squadLike, installDir, ports: { rcon: 21114 }, adminPassword: 'pw', net: { rcon: async (_, cmd) => (calls.push(cmd), '') } })
    expect(await admin.bans!()).toEqual([
      { id: '76561198000000001', reason: 'grief' },
      { id: '76561198000000002', reason: 'spam' }
    ])
    await admin.unban!('76561198000000001')
    expect(readFileSync(join(installDir, 'ServerConfig/Bans.cfg'), 'utf8')).toBe('76561198000000002:1767225600 //spam\n// note\n')
    expect(calls).toEqual(['AdminReloadServerConfig'])
  })

  // A real ARK server wrote "<SteamID64>," per line to ShooterGame/Binaries/Linux/BanList.txt.
  it("reads ARK's BanList.txt, one ID and a comma per line", async () => {
    const installDir = dir()
    mkdirSync(join(installDir, 'ShooterGame/Binaries/Linux'), { recursive: true })
    writeFileSync(join(installDir, 'ShooterGame/Binaries/Linux/BanList.txt'), '76561197960265729,\n76561198000000002,\n')
    const admin = adminFor({ game: game('ark-survival-evolved'), installDir, ports: { rcon: 27020 }, adminPassword: 'pw', net: { rcon: async () => '' } })
    expect(await admin.bans!()).toEqual([{ id: '76561197960265729' }, { id: '76561198000000002' }])
  })

  it("reads Warfork's listip.cfg as writeip leaves it", async () => {
    const installDir = dir()
    mkdirSync(join(installDir, 'basewf'))
    writeFileSync(join(installDir, 'basewf/listip.cfg'), 'set filterban 1\r\nban 76561198000000001 \r\nban 76561198000000002 30.00\r\naddip 1.2.3.4 30.00\r\n')
    const admin = adminFor({ game: game('warfork'), installDir, ports: { game: 44400 }, adminPassword: 'pw', net: { quake: async () => '' } })
    expect(await admin.bans!()).toEqual([{ id: '76561198000000001' }, { id: '76561198000000002' }])
  })

  it("reads BattlEye's bans.txt and unbans by taking the line out, then reloading it", async () => {
    const installDir = dir()
    mkdirSync(join(installDir, 'battleye'))
    writeFileSync(join(installDir, 'battleye/bans.txt'), '0123456789abcdef0123456789abcdef -1 cheating\n1.2.3.4 1767225600 spam\n')
    const calls: string[] = []
    const admin = adminFor({ game: game('dayz'), installDir, ports: { rcon: 2306 }, adminPassword: 'pw', net: { battleye: async (_, cmd) => (calls.push(cmd), '') } })
    expect(await admin.bans!()).toEqual([{ id: '0123456789abcdef0123456789abcdef', reason: 'cheating' }, { id: '1.2.3.4', reason: 'spam' }])
    await admin.ban!({ id: '0', name: 'Mira' }, 'grief')
    await admin.unban!('0123456789abcdef0123456789abcdef')
    expect(readFileSync(join(installDir, 'battleye/bans.txt'), 'utf8')).toBe('1.2.3.4 1767225600 spam\n')
    expect(calls).toEqual(['ban 0 0 grief', 'loadBans', 'loadBans'])
  })

  it('offers no kick when the definition names no kick command', async () => {
    const noKick: GameDefinition = { ...dataGame, players: { source: 'a2s', port: 'query' } }
    const admin = adminFor({ game: noKick, installDir: dir(), ports: { rcon: 27020, query: 27015 }, adminPassword: 'pw', net: recorder().net })
    expect(admin.kick).toBeUndefined()
  })
})

describe('player lists as each game prints them', () => {
  // Sample replies from the sources the definitions were built from (ark_rcon, SquadJS, NWI's admin guide, humanitzbot).
  const listed = (gameId: string, reply: string) =>
    adminFor({ game: game(gameId), installDir: dir(), ports: { rcon: 1, query: 2, game: 3 }, adminPassword: 'pw', net: { rcon: async () => reply, quake: async () => reply, pavlov: async () => reply, isle: async () => reply, battleye: async () => reply } }).players()

  it('ARK: ListPlayers', async () => {
    expect(await listed('ark-survival-evolved', '\n0. Mira, 76561198000000001\n1. Rook Bold, 76561198000000002 \n')).toEqual([
      { id: '76561198000000001', name: 'Mira' },
      { id: '76561198000000002', name: 'Rook Bold' }
    ])
    expect(await listed('ark-survival-evolved', 'No Players Connected')).toEqual([])
  })

  it('Squad: ListPlayers, old and new ID forms, without recently disconnected players', async () => {
    const reply = [
      '----- Active Players -----',
      'ID: 0 | Online IDs: EOS: 0002abcdef0123456789abcdef012345 steam: 76561198000000001 | Name: Mira | Team ID: 1 | Squad ID: N/A | Is Leader: False | Role: USA_Rifleman_01',
      'ID: 1 | SteamID: 76561198000000002 | Name: Rook | Bold | Team ID: 2 | Squad ID: 1 | Is Leader: True | Role: RUS_SL_01',
      '----- Recently Disconnected Players [Max of 15] -----',
      'ID: 2 | Online IDs: EOS: 0002 steam: 76561198000000003 | Since Disconnect: 02m.30s | Name: Gone'
    ].join('\n')
    for (const id of ['squad', 'squad-44']) {
      expect(await listed(id, reply)).toEqual([
        { id: '76561198000000001', name: 'Mira' },
        { id: '76561198000000002', name: 'Rook | Bold' }
      ])
    }
  })

  it('Insurgency: Sandstorm: listplayers, skipping bots', async () => {
    const reply = 'ID\t | Name\t\t | NetID\t\t | IP\t | Score\t | \n=====\n0\t | \t | None:INVALID\t | \t | 0\t |\n256\t | Mira\t\t | SteamNWI:76561198000000001\t | 127.0.0.1\t | 0\t |\n'
    expect(await listed('insurgency-sandstorm', reply)).toEqual([{ id: 'SteamNWI:76561198000000001', name: 'Mira' }])
  })

  it('Warfork: status, skipping bots, with names that fill their column', async () => {
    const reply = [
      'map              : wfca1',
      'num score ping name            steamid           lastmsg address               port   rate  ',
      '--- ----- ---- --------------- ----------------- ------- --------------------- ------ ------',
      '  0     3   42 Mira            76561198000000001      50 1.2.3.4:44400         44400  25000',
      '  1     0 CNCT Rook Bold       76561198000000002       0 5.6.7.8:44400         44400  25000',
      '  2    -1   12 SixteenCharsName76561198000000003      10 9.9.9.9:44400         44400  25000',
      '  3     0    0 [BOT] Bob                       0       0 loopback              0      BOT'
    ].join('\n')
    expect(await listed('warfork', reply)).toEqual([
      { id: '76561198000000001', name: 'Mira', ping: 42 },
      { id: '76561198000000002', name: 'Rook Bold' },
      { id: '76561198000000003', name: 'SixteenCharsName', ping: 12 }
    ])
  })

  it('Pavlov VR: RefreshList', async () => {
    const reply = '{\n\t"PlayerList": [\n\t\t{ "Username": "Mira", "UniqueId": "76561198000000001" },\n\t\t{ "Username": "Rook \\"B\\"", "UniqueId": "76561198000000002" }\n\t]\n}'
    expect(await listed('pavlov-vr', reply)).toEqual([
      { id: '76561198000000001', name: 'Mira' },
      { id: '76561198000000002', name: 'Rook \\"B\\"' }
    ])
  })

  it('The Isle: players, as the RCON client lines them up', async () => {
    expect(await listed('the-isle', '76561198000000001 Mira\n76561198000000002 Rook Bold')).toEqual([
      { id: '76561198000000001', name: 'Mira' },
      { id: '76561198000000002', name: 'Rook Bold' }
    ])
  })

  it('DayZ and Arma 3: BattlEye players, skipping players still joining', async () => {
    const reply = [
      'Players on server:',
      '[#] [IP Address]:[Port] [Ping] [GUID] [Name]',
      '--------------------------------------------------',
      '0   1.2.3.4:2304     47   0123456789abcdef0123456789abcdef(OK) Mira',
      '1   5.6.7.8:2304     12   fedcba9876543210fedcba9876543210(OK) Rook Bold (Lobby)',
      '2   9.9.9.9:2304     -1   -  Joining',
      '(3 players in total)'
    ].join('\n')
    for (const id of ['dayz', 'arma-3']) {
      expect(await listed(id, reply)).toEqual([
        { id: '0', name: 'Mira', ping: 47 },
        { id: '1', name: 'Rook Bold', ping: 12 }
      ])
    }
  })

  it('HumanitZ: Players', async () => {
    const reply = 'Mira (76561198000000001_+_|0002abc) Lv:27 Clan:X DPassed:54\r\nRook Bold (76561198000000002_+_|0002def) Lv:1 Clan: DPassed:0\r\n'
    expect(await listed('humanitz', reply)).toEqual([
      { id: '76561198000000001', name: 'Mira' },
      { id: '76561198000000002', name: 'Rook Bold' }
    ])
  })
})

describe('Natural Selection 2 admin (web admin)', () => {
  const ns2Net = (calls: string[]): AdminNet => ({
    ns2: () => ({
      state: async () => ({ player_list: [{ name: 'Mira', steamid: 1234567, ping: 40, isbot: false }, { name: 'Bot', steamid: 0, isbot: true }] }),
      send: async (cmd: string) => void calls.push(cmd)
    })
  })

  it('lists players from the server state, skipping bots, and kicks and bans with console commands', async () => {
    const calls: string[] = []
    const admin = adminFor({ game: game('natural-selection-2'), installDir: dir(), ports: { http: 8080 }, adminPassword: 'pw', net: ns2Net(calls) })
    expect(await admin.players()).toEqual([{ id: '1234567', name: 'Mira', ping: 40 }])
    await admin.kick!({ id: '1234567', name: 'Mira' }, 'afk')
    await admin.ban!({ id: '1234567', name: 'Mira' }, 'grief')
    await admin.unban!('1234567')
    expect(calls).toEqual(['sv_kick 1234567', 'sv_ban 1234567 0 grief', 'sv_unban 1234567'])
  })

  it('reads BannedPlayers.json', async () => {
    const installDir = dir()
    mkdirSync(join(installDir, 'neledport'))
    writeFileSync(join(installDir, 'neledport/BannedPlayers.json'), JSON.stringify([{ id: 1234567, name: 'Mira', reason: 'grief', time: 0 }]))
    const admin = adminFor({ game: game('natural-selection-2'), installDir, ports: { http: 8080 }, adminPassword: 'pw', net: ns2Net([]) })
    expect(await admin.bans!()).toEqual([{ id: '1234567', name: 'Mira', reason: 'grief' }])
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
