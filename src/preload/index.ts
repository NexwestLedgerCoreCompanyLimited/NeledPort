import { contextBridge, ipcRenderer } from 'electron'
import type { NeledPortApi } from '../core/types'

const api: NeledPortApi = {
  listGames: () => ipcRenderer.invoke('catalog:list')
}

contextBridge.exposeInMainWorld('neledport', api)
