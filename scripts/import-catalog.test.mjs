import { describe, expect, it } from 'vitest'
import { convertLgsm, parseCfg, tokenize } from './import-catalog.mjs'

const RUST_LIKE = `
port="28015"
rconport="28016"
queryport="28017"
servername="LinuxGSM" # shown in the browser
maxplayers="50"
rconpassword="CHANGE_ME"
startparameters="-batchmode +server.ip \${ip} +server.port \${port} +server.queryport \${queryport} +server.hostname \\"\${servername}\\" +server.identity \\"\${selfname}\\" +server.maxplayers \${maxplayers} +rcon.port \${rconport} +rcon.password \\"\${rconpassword}\\" -logfile \${gamelog}"
appid="258550"
systemdir="\${serverfiles}"
executabledir="\${serverfiles}"
executable="./RustDedicated"
`

describe('parseCfg', () => {
  it('reads quoted values, escaped quotes and strips comments', () => {
    const v = parseCfg(RUST_LIKE)
    expect(v.servername).toBe('LinuxGSM')
    expect(v.startparameters).toContain('+server.hostname "${servername}"')
  })
})

describe('tokenize', () => {
  it('splits like a shell, keeping quoted groups', () => {
    expect(tokenize(`-name 'My Server' +a "b c" plain`)).toEqual(['-name', 'My Server', '+a', 'b c', 'plain'])
  })
})

describe('convertLgsm', () => {
  it('turns a LinuxGSM config into a basic definition', () => {
    const def = convertLgsm(RUST_LIKE, { id: 'rustlike', name: 'Rustlike', gameAppId: 1 })
    expect(def.serverAppId).toBe(258550)
    expect(def.anonymous).toBe(true)
    expect(def.platforms.linux.executable).toBe('RustDedicated')
    expect(def.platforms.linux.args).toEqual([
      '-batchmode',
      '+server.ip',
      '0.0.0.0',
      '+server.port',
      '{port:game}',
      '+server.queryport',
      '{port:query}',
      '+server.hostname',
      '{setting:serverName}',
      '+server.identity',
      'neledport',
      '+server.maxplayers',
      '{setting:maxPlayers}',
      '+rcon.port',
      '{port:rcon}',
      '+rcon.password',
      '{adminPassword}'
    ])
    expect(def.ports).toEqual([
      { name: 'game', default: 28015, protocol: 'udp' },
      { name: 'query', default: 28017, protocol: 'udp' },
      { name: 'rcon', default: 28016, protocol: 'tcp' }
    ])
    expect(def.settings.map((s) => s.key)).toEqual(['serverName', 'maxPlayers'])
    expect(def.players).toEqual({ source: 'a2s', port: 'query' })
  })

  it('handles ${var:+text} and marks login-only servers', () => {
    const cfg = `steamuser="username"\nappid="1"\nport="1234"\nlogFile=""\nexecutabledir="\${serverfiles}/bin"\nexecutable="./srv"\nstartparameters="-x \${logFile:+ -logFile '\${logFile}'} -y"`
    const def = convertLgsm(cfg, { id: 'x', name: 'X' })
    expect(def.anonymous).toBe(false)
    expect(def.platforms.linux).toEqual({ executable: 'bin/srv', args: ['-x', '-y'] })
  })

  it('queries Source and GoldSrc servers for players on the game port', () => {
    const cfg = `appid="232250"\nport="27015"\nexecutabledir="\${serverfiles}"\nexecutable="./srcds_run"\nstartparameters="-game tf -port \${port}"`
    expect(convertLgsm(cfg, { id: 'tf', name: 'TF' }).players).toEqual({ source: 'a2s', port: 'game' })
  })

  it('skips servers whose executable lives outside the install folder', () => {
    const cfg = `appid="1"\nexecutabledir="\${HOME}/bin"\nexecutable="./srv"\nstartparameters=""`
    expect(() => convertLgsm(cfg, { id: 'x', name: 'X' })).toThrow(/outside/)
  })

  it('skips configs without a Steam app id', () => {
    expect(() => convertLgsm('executable="./java"', { id: 'x', name: 'X' })).toThrow(/app id/)
  })
})
