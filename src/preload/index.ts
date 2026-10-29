import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { NeledPortApi, ServerView } from '../core/types'

function subscribe<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as A))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.off(channel, listener)
}

const api: NeledPortApi = {
  appInfo: () => ipcRenderer.invoke('app:info'),
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
  onServerChanged: (cb) => subscribe<[ServerView]>('servers:changed', cb),
  onServerLine: (cb) => subscribe<[string, string]>('servers:line', cb)
}

contextBridge.exposeInMainWorld('neledport', api)
