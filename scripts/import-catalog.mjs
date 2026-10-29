// Regenerates "basic" game definitions from LinuxGSM (MIT) and the Steam dedicated-server search index from
// dgibbs64/SteamCMD-AppID-List (MIT). Hand-written definitions are never overwritten.
// Usage: node scripts/import-catalog.mjs <LinuxGSM checkout> <steamcmd_appid.csv>
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HAND_MADE = new Set(['palworld', 'valheim', 'rust', 'cs2', 'scum'])
const UNSUPPORTED = '\u0000unsupported\u0000'
const PORT_NAMES = { port: 'game', queryport: 'query', rconport: 'rcon', appport: 'app', clientport: 'client', sourcetvport: 'sourcetv', steamport: 'steam', beaconport: 'beacon', httpport: 'http', telnetport: 'telnet' }
const TCP_PORTS = new Set(['rcon', 'http', 'app', 'telnet'])
// LinuxGSM paths and logs that NeledPort manages itself or that live outside the install folder.
const DROPPED_VARS = new Set(['HOME', 'rootdir', 'lgsmdir', 'logdir', 'lgsmlogdir', 'consolelogdir', 'LGSM_LOGDIR', 'gamelogdir', 'gamelog', 'publicip'])

export function parseCfg(text) {
  const vars = {}
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z_]\w*)="(.*)"(?:\s+#.*)?$/.exec(line.trim())
    if (m) vars[m[1]] = m[2].replace(/\\"/g, '"')
  }
  return vars
}

export function tokenize(s) {
  const out = []
  let cur = ''
  let quote = null
  let quoted = false
  for (const c of s) {
    if (quote) {
      if (c === quote) quote = null
      else cur += c
    } else if (c === "'" || c === '"') {
      quote = c
      quoted = true
    } else if (/\s/.test(c)) {
      if (cur || quoted) out.push(cur)
      cur = ''
      quoted = false
    } else cur += c
  }
  if (cur || quoted) out.push(cur)
  return out
}

// Expands ${name} and ${name:+alt} (nested braces allowed) with NeledPort placeholders.
function expander(vars) {
  const ports = []
  const settings = new Set()

  function value(name, depth) {
    if (depth > 20) return UNSUPPORTED
    const raw = vars[name]
    if (/port$/i.test(name) && /^\d+$/.test(raw ?? '')) {
      const portName = PORT_NAMES[name] ?? name.replace(/port$/i, '')
      if (!ports.some((p) => p.name === portName)) ports.push({ name: portName, default: Number(raw), protocol: TCP_PORTS.has(portName) ? 'tcp' : 'udp' })
      return `{port:${portName}}`
    }
    const special = {
      servername: '{setting:serverName}',
      maxplayers: '{setting:maxPlayers}',
      serverpassword: '{setting:password}',
      gslt: '{setting:gslt}',
      adminpassword: '{adminPassword}',
      rconpassword: '{adminPassword}',
      serverfiles: '{installDir}',
      selfname: 'neledport',
      ip: '0.0.0.0'
    }[name]
    if (special) {
      if (special.startsWith('{setting:')) settings.add(name)
      return special
    }
    if (DROPPED_VARS.has(name) || raw === undefined) return UNSUPPORTED
    return expand(raw, depth + 1)
  }

  function expand(text, depth = 0) {
    let out = ''
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== '$' || text[i + 1] !== '{') {
        out += text[i]
        continue
      }
      let level = 1
      let j = i + 2
      while (j < text.length && level > 0) {
        if (text[j] === '{') level++
        else if (text[j] === '}') level--
        j++
      }
      const inner = text.slice(i + 2, j - 1)
      const alt = /^(\w+):\+([\s\S]*)$/.exec(inner)
      if (alt) {
        const v = value(alt[1], depth)
        out += v && !v.includes(UNSUPPORTED) ? expand(alt[2], depth + 1) : ''
      } else out += value(inner, depth)
      i = j - 1
    }
    return out
  }

  return { expand, ports, settings }
}

function dropUnsupported(tokens) {
  const out = []
  for (const t of tokens) {
    if (!t.includes(UNSUPPORTED)) {
      out.push(t)
      continue
    }
    // "-logfile <dropped>": the flag has no value left, so drop it too.
    const prev = out[out.length - 1]
    if (!/^[-+]/.test(t) && prev && /^[-+]/.test(prev) && !prev.includes('=')) out.pop()
  }
  return out
}

export function convertLgsm(cfgText, meta) {
  const vars = parseCfg(cfgText)
  if (!/^\d+$/.test(vars.appid ?? '')) throw new Error('no Steam app id')
  const { expand, ports, settings } = expander(vars)

  const exeDir = expand(vars.executabledir ?? '${serverfiles}')
  const exeFull = `${exeDir}/${(vars.executable ?? '').replace(/^\.\//, '')}`
  if (!exeFull.startsWith('{installDir}') || exeFull.includes(UNSUPPORTED)) throw new Error('executable is outside the install folder')
  const executable = exeFull.slice('{installDir}'.length).replace(/^\/+/, '')
  if (!executable || executable.split('/').includes('..') || executable.includes('{')) throw new Error('executable path cannot be resolved')

  const args = dropUnsupported(tokenize(expand(vars.startparameters ?? ''))).filter((a) => a !== '')
  if (vars.port && /^\d+$/.test(vars.port) && !ports.some((p) => p.name === 'game')) {
    ports.unshift({ name: 'game', default: Number(vars.port), protocol: 'udp' })
  }
  ports.sort((a, b) => (a.name === 'game' ? -1 : b.name === 'game' ? 1 : 0))
  if (!ports.length) throw new Error('no ports')

  const settingDefs = []
  if (settings.has('servername')) settingDefs.push({ key: 'serverName', label: 'Server name', type: 'text', default: 'NeledPort server' })
  if (settings.has('maxplayers')) settingDefs.push({ key: 'maxPlayers', label: 'Max players', type: 'number', default: Number(vars.maxplayers) || 16 })
  if (settings.has('serverpassword')) settingDefs.push({ key: 'password', label: 'Server password (optional)', type: 'password', secret: true })
  if (settings.has('gslt')) settingDefs.push({ key: 'gslt', label: 'Steam game server token (optional)', type: 'password', secret: true })

  const def = {
    $schema: './schema.json',
    id: meta.id,
    name: meta.name,
    serverAppId: Number(vars.appid),
    ...(meta.gameAppId ? { gameAppId: meta.gameAppId } : {}),
    anonymous: vars.steamuser !== 'username',
    tier: 'basic',
    ...(settingDefs.length ? { settings: settingDefs } : {}),
    platforms: { linux: { executable, args } },
    ports,
    control: { type: 'signal' },
    ...queryPort(ports, executable)
  }
  return def
}

// Steam query (A2S) answers on the query port, or on the game port for Source/GoldSrc servers.
function queryPort(ports, executable) {
  if (ports.some((p) => p.name === 'query')) return { players: { source: 'a2s', port: 'query' } }
  if (/(^|\/)(srcds|hlds)_/.test(executable)) return { players: { source: 'a2s', port: 'game' } }
  return {}
}

const slug = (name) =>
  name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

function readAppIds(csvFile) {
  return readFileSync(csvFile, 'utf8')
    .split(/\r?\n/)
    .map((line) => /^(\d+),"(.*)"$/.exec(line))
    .filter(Boolean)
    .map((m) => ({ appId: Number(m[1]), name: m[2].replace(/""/g, '"') }))
}

// docs/GAMES.md: the human-readable list of every definition, linked from the README.
function writeGamesDoc(gamesDir, searchable) {
  const defs = readdirSync(gamesDir)
    .filter((f) => f.endsWith('.json') && f !== 'schema.json')
    .map((f) => JSON.parse(readFileSync(join(gamesDir, f), 'utf8')))
    .sort((a, b) => Number(b.tier === 'full') - Number(a.tier === 'full') || a.name.localeCompare(b.name))
  const rows = defs.map((d) => {
    const os = ['windows', 'linux'].filter((p) => d.platforms[p]).map((p) => p[0].toUpperCase() + p.slice(1)).join(', ')
    const notes = [!d.anonymous && 'needs Steam sign-in (coming soon)', d.players && 'player list', d.bans && 'bans', d.control?.type === 'webrcon' || d.control?.type === 'rcon' || d.control?.type === 'rest' ? 'console' : null]
      .filter(Boolean)
      .join(', ')
    return `| ${d.name} | ${d.tier} | ${d.serverAppId} | ${os || '—'} | ${notes} |`
  })
  const doc = [
    '# Supported games',
    '',
    `NeledPort knows **${defs.length} games**. Any other Steam dedicated server works through **Any Steam App ID**, which also searches ${searchable} more servers by name.`,
    '',
    'Tiers: **full** = written by hand with player list, bans and console support; **basic** = install and run, imported from',
    '[LinuxGSM](https://github.com/GameServerManagers/LinuxGSM) and waiting for someone to test it. "OS" lists the platforms whose',
    'launcher is known; on other systems you pick the program once after installing and can share it back.',
    '',
    'Missing a game, or tested one? See [CONTRIBUTING](../CONTRIBUTING.md#add-a-game). This file is generated by `scripts/import-catalog.mjs`.',
    '',
    '| Game | Tier | App ID | OS | Extras |',
    '|---|---|---|---|---|',
    ...rows,
    ''
  ].join('\n')
  writeFileSync(join(gamesDir, '..', 'docs', 'GAMES.md'), doc)
}

function main(lgsmDir, csvFile) {
  const gamesDir = join(fileURLToPath(new URL('..', import.meta.url)), 'games')
  const appIds = readAppIds(csvFile)
  const byName = new Map()
  for (const a of appIds) {
    const key = a.name.toLowerCase()
    byName.set(key, byName.has(key) ? null : a.appId)
  }
  const handMadeAppIds = new Set(
    [...HAND_MADE].map((id) => JSON.parse(readFileSync(join(gamesDir, `${id}.json`), 'utf8')).serverAppId)
  )

  const list = readFileSync(join(lgsmDir, 'lgsm/data/serverlist.csv'), 'utf8').split(/\r?\n/).slice(1)
  const written = []
  const skipped = []
  // Known servers that could not become definitions still belong in the any-App-ID search.
  const searchable = []
  for (const row of list) {
    const [, server, gameName] = row.split(',')
    if (!server) continue
    const cfgFile = join(lgsmDir, 'lgsm/config-default/config-lgsm', server, '_default.cfg')
    if (!existsSync(cfgFile)) continue
    const id = slug(gameName)
    if (HAND_MADE.has(id)) continue
    try {
      const def = convertLgsm(readFileSync(cfgFile, 'utf8'), { id, name: gameName, gameAppId: byName.get(gameName.toLowerCase()) ?? undefined })
      if (handMadeAppIds.has(def.serverAppId)) continue
      writeFileSync(join(gamesDir, `${id}.json`), JSON.stringify(def, null, 2) + '\n')
      written.push(id)
    } catch (e) {
      skipped.push(`${gameName}: ${e.message}`)
      const appid = parseCfg(readFileSync(cfgFile, 'utf8')).appid
      if (/^\d+$/.test(appid ?? '')) searchable.push({ appId: Number(appid), name: `${gameName} Dedicated Server` })
    }
  }

  const catalogAppIds = new Set(
    readdirSync(gamesDir)
      .filter((f) => f.endsWith('.json') && f !== 'schema.json')
      .map((f) => JSON.parse(readFileSync(join(gamesDir, f), 'utf8')).serverAppId)
  )
  const seen = new Set()
  const servers = [...searchable, ...appIds.filter((a) => /dedicated server/i.test(a.name))]
    .filter((a) => !catalogAppIds.has(a.appId) && !seen.has(a.appId) && seen.add(a.appId))
    .sort((a, b) => a.name.localeCompare(b.name))
  mkdirSync(join(gamesDir, 'index'), { recursive: true })
  writeFileSync(
    join(gamesDir, 'index', 'steam-servers.json'),
    JSON.stringify({ source: 'dgibbs64/SteamCMD-AppID-List (MIT)', servers }, null, 1) + '\n'
  )

  writeGamesDoc(gamesDir, servers.length)
  console.log(`wrote ${written.length} definitions, ${servers.length} searchable Steam servers`)
  console.log(`skipped ${skipped.length}:\n  ${skipped.join('\n  ')}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv[2], process.argv[3])
