import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { palworldRest, prepareConfig, readOptionSettings, writeOptionSettings } from './palworld'

const DEFAULT_INI = `; This configuration file is a sample of the default server settings.
[/Script/Pal.PalGameWorldSettings]
OptionSettings=(Difficulty=None,DayTimeSpeedRate=1.000000,ServerPlayerMaxNum=32,ServerName="Default Palworld Server",ServerDescription="",AdminPassword="",ServerPassword="",PublicPort=8211,PublicIP="",RCONEnabled=False,RCONPort=25575,BanListURL="https://api.palworldgame.com/api/banlist.txt",RESTAPIEnabled=False,RESTAPIPort=8212,CrossplayPlatforms=(Steam,Xbox,PS5,Mac),ServerDescriptionAlt="a, b")
`

describe('OptionSettings', () => {
  it('reads values, including quoted commas and nested lists', () => {
    const o = readOptionSettings(DEFAULT_INI)
    expect(o.ServerName).toBe('"Default Palworld Server"')
    expect(o.CrossplayPlatforms).toBe('(Steam,Xbox,PS5,Mac)')
    expect(o.ServerDescriptionAlt).toBe('"a, b"')
    expect(o.RESTAPIPort).toBe('8212')
  })

  it('patches values and keeps everything else', () => {
    const out = writeOptionSettings(DEFAULT_INI, { ServerName: 'Friends Island', RESTAPIEnabled: true, ServerPlayerMaxNum: 16 })
    const o = readOptionSettings(out)
    expect(o.ServerName).toBe('"Friends Island"')
    expect(o.RESTAPIEnabled).toBe('True')
    expect(o.ServerPlayerMaxNum).toBe('16')
    expect(o.CrossplayPlatforms).toBe('(Steam,Xbox,PS5,Mac)')
    expect(out.startsWith('; This configuration file')).toBe(true)
  })

  it('drops quotes from values so a name cannot break the file', () => {
    const out = writeOptionSettings(DEFAULT_INI, { ServerName: 'Evil",AdminPassword="x' })
    expect(readOptionSettings(out).AdminPassword).toBe('""')
  })

  it('throws when the line is missing', () => {
    expect(() => readOptionSettings('[x]\n')).toThrow(/OptionSettings/)
  })
})

describe('prepareConfig', () => {
  it('copies the default file and enables the REST API on first run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pal-'))
    writeFileSync(join(dir, 'DefaultPalWorldSettings.ini'), DEFAULT_INI)
    const file = prepareConfig(dir, 'linux', {
      serverName: 'Friends Island',
      password: '',
      adminPassword: 'secret123',
      maxPlayers: 16,
      gamePort: 8211,
      restPort: 8212
    })
    expect(file).toBe(join(dir, 'Pal/Saved/Config/LinuxServer/PalWorldSettings.ini'))
    const o = readOptionSettings(readFileSync(file, 'utf8'))
    expect(o.AdminPassword).toBe('"secret123"')
    expect(o.RESTAPIEnabled).toBe('True')
    expect(o.ServerPlayerMaxNum).toBe('16')
  })

  it('reuses an existing settings file but replaces an empty one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pal-'))
    writeFileSync(join(dir, 'DefaultPalWorldSettings.ini'), DEFAULT_INI)
    const cfgDir = join(dir, 'Pal/Saved/Config/WindowsServer')
    mkdirSync(cfgDir, { recursive: true })
    writeFileSync(join(cfgDir, 'PalWorldSettings.ini'), '')
    const file = prepareConfig(dir, 'windows', {
      serverName: 'A',
      password: 'pw',
      adminPassword: 'adm',
      maxPlayers: 8,
      gamePort: 9000,
      restPort: 9001
    })
    expect(readOptionSettings(readFileSync(file, 'utf8')).PublicPort).toBe('9000')
  })
})

describe('palworldRest', () => {
  it('sends Basic auth and JSON to the base path', async () => {
    const seen: { method?: string; url?: string; auth?: string; body: string }[] = []
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body })
        res.setHeader('Content-Type', 'application/json')
        res.end(req.url?.endsWith('/players') ? '{"players":[{"name":"Mira"}]}' : '')
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    const api = palworldRest({ port, basePath: '/v1/api', username: 'admin', password: 'pw' })
    await api.shutdown(1, 'bye')
    expect(await api.players()).toEqual({ players: [{ name: 'Mira' }] })
    server.close()
    expect(seen[0]).toEqual({
      method: 'POST',
      url: '/v1/api/shutdown',
      auth: 'Basic ' + Buffer.from('admin:pw').toString('base64'),
      body: '{"waittime":1,"message":"bye"}'
    })
  })

  it('throws on a non-2xx answer', async () => {
    const server = createServer((_, res) => ((res.statusCode = 401), res.end()))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    await expect(palworldRest({ port, basePath: '/v1/api', username: 'admin', password: 'x' }).save()).rejects.toThrow(/401/)
    server.close()
  })
})
