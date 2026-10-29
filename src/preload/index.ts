import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { NeledPortApi, ServerView, UpdateState } from '../core/types'

function subscribe<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as A))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.off(channel, listener)
}

const api: NeledPortApi = {
  appInfo: () => ipcRenderer.invoke('app:info'),
  setLanguage: (lang) => ipcRenderer.invoke('app:setLanguage', lang),
  updateState: () => ipcRenderer.invoke('app:updateState'),
  installUpdate: () => ipcRenderer.invoke('app:installUpdate'),
  onUpdateChanged: (cb) => subscribe<[UpdateState]>('app:updateChanged', cb),
  steamAccount: () => ipcRenderer.invoke('steam:account'),
  steamSignIn: (user) => ipcRenderer.invoke('steam:signIn', user),
  steamSignOut: () => ipcRenderer.invoke('steam:signOut'),
  steamCheck: () => ipcRenderer.invoke('steam:check'),
  listGames: () => ipcRenderer.invoke('catalog:list'),
  listServers: () => ipcRenderer.invoke('servers:list'),
  createServer: (input) => ipcRenderer.invoke('servers:create', input),
  serverAction: (action, id) => ipcRenderer.invoke('servers:action', action, id),
  serverLines: (id) => ipcRenderer.invoke('servers:lines', id),
  serverBackups: (id) => ipcRenderer.invoke('servers:backups', id),
  players: (id) => ipcRenderer.invoke('servers:players', id),
  kick: (id, player) => ipcRenderer.invoke('servers:kick', id, player),
  ban: (id, player, reason) => ipcRenderer.invoke('servers:ban', id, player, reason),
  unban: (id, banId) => ipcRenderer.invoke('servers:unban', id, banId),
  bans: (id) => ipcRenderer.invoke('servers:bans', id),
  command: (id, text) => ipcRenderer.invoke('servers:command', id, text),
  checkBuild: (id) => ipcRenderer.invoke('servers:checkBuild', id),
  steamServers: () => ipcRenderer.invoke('catalog:steamServers'),
  pickProgram: (id) => ipcRenderer.invoke('servers:pickProgram', id),
  setLaunch: (id, program, args) => ipcRenderer.invoke('servers:setLaunch', id, program, args),
  shareDefinition: (id) => ipcRenderer.invoke('servers:share', id),
  installLoader: (id, loaderId) => ipcRenderer.invoke('servers:loader', id, loaderId, 'install'),
  uninstallLoader: (id, loaderId) => ipcRenderer.invoke('servers:loader', id, loaderId, 'uninstall'),
  plugins: (id, loaderId) => ipcRenderer.invoke('servers:plugins', id, loaderId),
  setPluginEnabled: (id, loaderId, name, enabled) => ipcRenderer.invoke('servers:plugin', id, loaderId, name, enabled ? 'enable' : 'disable'),
  removePlugin: (id, loaderId, name) => ipcRenderer.invoke('servers:plugin', id, loaderId, name, 'remove'),
  addPlugin: (id, loaderId) => ipcRenderer.invoke('servers:addPlugin', id, loaderId),
  workshop: (id, itemId) => ipcRenderer.invoke('servers:workshop', id, itemId),
  onServerChanged: (cb) => subscribe<[ServerView]>('servers:changed', cb),
  onServerLine: (cb) => subscribe<[string, string]>('servers:line', cb)
}

contextBridge.exposeInMainWorld('neledport', api)
