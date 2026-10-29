import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '../core/types'

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

let state: UpdateState = { status: 'none' }

export const updateState = (): UpdateState => state

/**
 * Downloads new releases from GitHub in the background. Only the Windows installer and the AppImage can replace
 * themselves; .deb installs and dev runs never check.
 */
export function startUpdates(onChange: (state: UpdateState) => void): void {
  if (!app.isPackaged || !(process.platform === 'win32' || process.env.APPIMAGE)) return
  const set = (next: UpdateState) => onChange((state = next))

  // Every 0.x release is a GitHub pre-release, which the default (stable only) never sees. From 1.0, stay on stable.
  autoUpdater.allowPrerelease = app.getVersion().startsWith('0.')
  autoUpdater.on('update-available', (info) => set({ status: 'downloading', version: info.version, percent: 0 }))
  autoUpdater.on('download-progress', (p) => state.status === 'downloading' && set({ ...state, percent: Math.floor(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', version: info.version }))
  autoUpdater.on('error', (e) => {
    console.error('[NeledPort] update check failed:', e.message)
    if (state.status === 'downloading') set({ status: 'none' })
  })

  const check = () => state.status === 'none' && void autoUpdater.checkForUpdates().catch(() => {})
  check()
  setInterval(check, CHECK_EVERY_MS)
}

/** Call only after servers are stopped: the installer replaces the app and starts it again. */
export function installUpdate(): void {
  if (state.status === 'ready') autoUpdater.quitAndInstall(true, true)
}
