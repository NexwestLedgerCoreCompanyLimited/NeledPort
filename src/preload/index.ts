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
  onServerChanged: (cb) => subscribe<[ServerView]>('servers:changed', cb),
  onServerLine: (cb) => subscribe<[string, string]>('servers:line', cb)
}

contextBridge.exposeInMainWorld('neledport', api)
