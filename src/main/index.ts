import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { loadCatalog } from '../core/catalog'

const gamesDir = (): string =>
  app.isPackaged ? join(process.resourcesPath, 'games') : join(app.getAppPath(), 'games')

function createWindow(): void {
  const win = new BrowserWindow({
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

  win.once('ready-to-show', () => win.show())

  // The app never hosts third-party pages: links open in the system browser, navigation is blocked.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

ipcMain.handle('catalog:list', () => loadCatalog(gamesDir()))

void app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
