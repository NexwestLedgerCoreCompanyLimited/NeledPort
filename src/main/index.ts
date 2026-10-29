import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadCatalog } from '../core/catalog'
import { isLanguage, pickLanguage, translate, type MessageKey } from '../core/i18n'
import { ServerManager } from '../core/manager'
import { installUpdate, startUpdates, updateState } from './updater'
import type { AppInfo, CreateServerInput, Platform, PlayerInfo, ServerAction } from '../core/types'

const gamesDir = (): string =>
  app.isPackaged ? join(process.resourcesPath, 'games') : join(app.getAppPath(), 'games')

// Dedicated servers exist for Windows and Linux only; macOS runs the UI for development.
const platform: Platform = process.platform === 'win32' ? 'windows' : 'linux'
const canHostServers = process.platform === 'win32' || process.platform === 'linux'
// Game servers are many GB, so they live in the user's home folder, not in hidden app data.
const serversDir = join(homedir(), 'NeledPort', 'servers')

let win: BrowserWindow | null = null
let manager: ServerManager
const catalog = () => loadCatalog(gamesDir())

const secrets = {
  encrypt: (plain: string) =>
    safeStorage.isEncryptionAvailable()
      ? 'v1:' + safeStorage.encryptString(plain).toString('base64')
      : 'v0:' + Buffer.from(plain).toString('base64'),
  decrypt: (stored: string) =>
    stored.startsWith('v1:')
      ? safeStorage.decryptString(Buffer.from(stored.slice(3), 'base64'))
      : Buffer.from(stored.slice(3), 'base64').toString()
}

const REPO = 'NexwestLedgerCoreCompanyLimited/NeledPort'

// Follows the language picked in the app; the system language until the window reports it.
let language = 'en'
const t = (key: MessageKey, vars?: Record<string, string | number>) => translate(language, key, vars)

function steamServers(): { appId: number; name: string }[] {
  const file = join(gamesDir(), 'index', 'steam-servers.json')
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).servers : []
}

const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}$/.test(v)
const isText = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max
function parsePlayer(v: unknown): PlayerInfo {
  const p = v as Record<string, unknown>
  if (!isText(p?.id) || !isText(p?.name)) throw new Error('Invalid player')
  return { id: p.id, name: p.name }
}

const isStringRecord = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' && v !== null && Object.values(v).every((x) => typeof x === 'string')

// The renderer is treated as untrusted: every payload is checked before it reaches the manager.
function parseCreate(v: unknown): CreateServerInput {
  const o = v as Record<string, unknown>
  if (typeof o?.gameId !== 'string' || typeof o.name !== 'string' || !isStringRecord(o.settings)) {
    throw new Error('Invalid server details')
  }
  if (o.installDir !== undefined && typeof o.installDir !== 'string') throw new Error('Invalid install folder')
  const custom = o.custom as { appId?: unknown; name?: unknown } | undefined
  if (custom !== undefined && (!Number.isInteger(custom?.appId) || !isText(custom?.name, 80))) throw new Error('Invalid App ID')
  if (o.ports !== undefined && (typeof o.ports !== 'object' || !Object.values(o.ports as object).every(Number.isInteger))) {
    throw new Error('Invalid ports')
  }
  return {
    gameId: o.gameId,
    name: o.name,
    settings: o.settings,
    installDir: o.installDir as string | undefined,
    ports: o.ports as Record<string, number> | undefined,
    ...(custom ? { custom: { appId: custom.appId as number, name: custom.name as string } } : {})
  }
}

function registerIpc(): void {
  const actions: Record<ServerAction, (id: string) => Promise<unknown>> = {
    install: (id) => manager.install(id),
    start: (id) => manager.start(id),
    stop: (id) => manager.stop(id),
    restart: (id) => manager.restart(id),
    update: (id) => manager.update(id),
    backup: (id) => manager.backup(id, 'manual'),
    remove: async (id) => manager.remove(id),
    openFolder: (id) => shell.openPath(manager.get(id).installDir)
  }

  ipcMain.handle('app:info', (): AppInfo => ({ platform, canHostServers, serversDir, loadError: manager.loadError }))
  ipcMain.handle('app:setLanguage', (_event, lang: unknown) => {
    if (isLanguage(lang)) language = lang
  })
  ipcMain.handle('app:updateState', updateState)
  ipcMain.handle('app:installUpdate', async () => {
    if (updateState().status !== 'ready') return
    quitting = true
    // Same as quitting: servers save and stop before the installer replaces the app.
    await manager.stopAll().finally(installUpdate)
  })
  ipcMain.handle('catalog:list', () => catalog())
  ipcMain.handle('servers:list', () => manager.list())
  ipcMain.handle('servers:create', (_e, input: unknown) => manager.create(parseCreate(input)))
  ipcMain.handle('servers:action', async (_e, action: unknown, id: unknown) => {
    if (typeof action !== 'string' || !(action in actions) || !isId(id)) throw new Error('Invalid request')
    await actions[action as ServerAction](id)
  })
  ipcMain.handle('servers:lines', (_e, id: unknown) => {
    if (!isId(id)) throw new Error('Invalid request')
    return manager.lines(id)
  })
  ipcMain.handle('servers:backups', (_e, id: unknown) => {
    if (!isId(id)) throw new Error('Invalid request')
    return manager.backups(id)
  })
  const withId = <A extends unknown[], R>(fn: (id: string, ...args: A) => R) => (_e: unknown, id: unknown, ...args: A): R => {
    if (!isId(id)) throw new Error('Invalid request')
    return fn(id, ...args)
  }
  ipcMain.handle('servers:players', withId((id) => manager.players(id)))
  ipcMain.handle('servers:kick', withId((id, player: unknown) => manager.kick(id, parsePlayer(player))))
  ipcMain.handle(
    'servers:ban',
    withId((id, player: unknown, reason: unknown) => manager.ban(id, parsePlayer(player), isText(reason) && reason ? reason : undefined))
  )
  ipcMain.handle(
    'servers:unban',
    withId((id, banId: unknown) => {
      if (!isText(banId) || !banId) throw new Error('Invalid ban')
      return manager.unban(id, banId)
    })
  )
  ipcMain.handle('servers:bans', withId((id) => manager.bans(id)))
  ipcMain.handle(
    'servers:command',
    withId((id, text: unknown) => {
      if (!isText(text, 500)) throw new Error('Invalid command')
      return manager.command(id, text)
    })
  )
  ipcMain.handle('servers:checkBuild', withId((id) => manager.checkBuild(id)))
  ipcMain.handle('catalog:steamServers', () => steamServers())
  const isLoaderId = (v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z0-9-]*$/.test(v)
  ipcMain.handle(
    'servers:loader',
    withId((id, loaderId: unknown, action: unknown) => {
      if (!isLoaderId(loaderId)) throw new Error('Invalid mod loader')
      if (action === 'install') return manager.installLoader(id, loaderId)
      if (action === 'uninstall') return manager.uninstallLoader(id, loaderId)
      throw new Error('Invalid request')
    })
  )
  ipcMain.handle(
    'servers:plugins',
    withId((id, loaderId: unknown) => {
      if (!isLoaderId(loaderId)) throw new Error('Invalid mod loader')
      return manager.plugins(id, loaderId)
    })
  )
  ipcMain.handle(
    'servers:plugin',
    withId((id, loaderId: unknown, name: unknown, action: unknown) => {
      if (!isLoaderId(loaderId) || !isText(name, 200)) throw new Error('Invalid plugin')
      if (action === 'remove') return manager.removePlugin(id, loaderId, name)
      if (action === 'enable' || action === 'disable') return manager.setPluginEnabled(id, loaderId, name, action === 'enable')
      throw new Error('Invalid request')
    })
  )
  ipcMain.handle(
    'servers:addPlugin',
    withId(async (id, loaderId: unknown) => {
      if (!isLoaderId(loaderId)) throw new Error('Invalid mod loader')
      const result = await dialog.showOpenDialog(win!, { title: t('dialog.addPlugin'), properties: ['openFile'] })
      if (result.canceled || !result.filePaths[0]) return false
      manager.addPlugin(id, loaderId, result.filePaths[0])
      return true
    })
  )
  ipcMain.handle(
    'servers:workshop',
    withId((id, itemId: unknown) => {
      if (!isText(itemId, 30)) throw new Error('Invalid Workshop item')
      return manager.workshop(id, itemId)
    })
  )
  ipcMain.handle(
    'servers:pickProgram',
    withId(async (id) => {
      const result = await dialog.showOpenDialog(win!, {
        title: t('dialog.chooseProgram'),
        defaultPath: manager.get(id).installDir,
        properties: ['openFile']
      })
      return result.canceled ? null : result.filePaths[0]
    })
  )
  ipcMain.handle(
    'servers:setLaunch',
    withId((id, program: unknown, args: unknown) => {
      if (!isText(program, 1000) || !isText(args, 1000)) throw new Error('Invalid program')
      return manager.setLaunch(id, program, args)
    })
  )
  ipcMain.handle(
    'servers:share',
    withId(async (id) => {
      const def = manager.shareDefinition(id)
      const url = `https://github.com/${REPO}/new/main/games?filename=${def.id}.json&value=${encodeURIComponent(JSON.stringify(def, null, 2) + '\n')}`
      await shell.openExternal(url)
      return url
    })
  )
}

function createWindow(): void {
  win = new BrowserWindow({
    title: 'NeledPort',
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#07090f',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => (win = null))

  // The app never hosts third-party pages: links open in the system browser, navigation is blocked.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win?.webContents.getURL()) event.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

const busy = new Set(['starting', 'running', 'stopping', 'installing', 'updating'])
let quitting = false

app.on('before-quit', (event) => {
  if (quitting || !manager) return
  const active = manager.list().filter((s) => busy.has(s.status))
  if (!active.length) return
  event.preventDefault()
  const choice = dialog.showMessageBoxSync({
    type: 'question',
    buttons: [t('quit.stopAndQuit'), t('common.cancel')],
    defaultId: 0,
    cancelId: 1,
    message: t('quit.running', { count: active.length }),
    detail: t('quit.detail')
  })
  if (choice !== 0) return
  quitting = true
  void manager.stopAll().finally(() => app.quit())
})

void app.whenReady().then(() => {
  language = pickLanguage([app.getLocale()])
  manager = new ServerManager({
    dataDir: app.getPath('userData'),
    serversDir,
    platform,
    games: () => catalog().games,
    secrets,
    steamSdkDir: process.platform === 'linux' ? join(homedir(), '.steam') : undefined
  })
  manager.on('changed', (view) => win?.webContents.send('servers:changed', view))
  manager.on('line', (id: string, line: string) => win?.webContents.send('servers:line', id, line))
  registerIpc()
  createWindow()
  startUpdates((state) => win?.webContents.send('app:updateChanged', state))
})

app.on('window-all-closed', () => app.quit())
