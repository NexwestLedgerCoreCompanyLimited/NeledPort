import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadCatalog } from '../core/catalog'
import { ServerManager } from '../core/manager'
import type { AppInfo, CreateServerInput, Platform, ServerAction } from '../core/types'

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

const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}$/.test(v)
const isStringRecord = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' && v !== null && Object.values(v).every((x) => typeof x === 'string')

// The renderer is treated as untrusted: every payload is checked before it reaches the manager.
function parseCreate(v: unknown): CreateServerInput {
  const o = v as Record<string, unknown>
  if (typeof o?.gameId !== 'string' || typeof o.name !== 'string' || !isStringRecord(o.settings)) {
    throw new Error('Invalid server details')
  }
  if (o.installDir !== undefined && typeof o.installDir !== 'string') throw new Error('Invalid install folder')
  if (o.ports !== undefined && (typeof o.ports !== 'object' || !Object.values(o.ports as object).every(Number.isInteger))) {
    throw new Error('Invalid ports')
  }
  return {
    gameId: o.gameId,
    name: o.name,
    settings: o.settings,
    installDir: o.installDir as string | undefined,
    ports: o.ports as Record<string, number> | undefined
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
    buttons: ['Stop servers and quit', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: `${active.length} server${active.length > 1 ? 's are' : ' is'} still running`,
    detail: 'NeledPort will save and stop them before closing.'
  })
  if (choice !== 0) return
  quitting = true
  void manager.stopAll().finally(() => app.quit())
})

void app.whenReady().then(() => {
  manager = new ServerManager({
    dataDir: app.getPath('userData'),
    serversDir,
    platform,
    games: () => catalog().games,
    secrets
  })
  manager.on('changed', (view) => win?.webContents.send('servers:changed', view))
  manager.on('line', (id: string, line: string) => win?.webContents.send('servers:line', id, line))
  registerIpc()
  createWindow()
})

app.on('window-all-closed', () => app.quit())
