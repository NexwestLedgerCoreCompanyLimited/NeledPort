export type Platform = 'windows' | 'linux'

export interface PlatformDefinition {
  executable: string
  args: string[]
  env?: Record<string, string>
  configFiles?: { path: string; format: 'ini' | 'json' | 'cfg' | 'txt' }[]
}

export interface SettingDefinition {
  key: string
  label: string
  type: 'text' | 'password' | 'number'
  default?: string | number
  minLength?: number
  secret?: boolean
}

export interface GameDefinition {
  id: string
  name: string
  serverAppId: number
  gameAppId?: number
  anonymous: boolean
  tier: 'full' | 'basic' | 'custom'
  platforms: Partial<Record<Platform, PlatformDefinition>>
  ports: { name: string; default: number; protocol: 'udp' | 'tcp' }[]
  settings?: SettingDefinition[]
  configAdapter?: 'palworld'
  saveDir?: string
  control?: {
    type: 'rcon' | 'webrcon' | 'rest' | 'stdin' | 'signal'
    save?: string
    shutdown?: string
    rest?: { port: string; basePath: string; username: string }
  }
  players?: { source: 'rest' | 'rcon' | 'a2s' | 'log' }
  bans?: { method: 'rest' | 'rcon' | 'file' }
  logPatterns?: { ready?: string; join?: string; leave?: string }
  workshop?: Record<string, unknown> | null
  modLoaders?: unknown[]
}

export type CatalogError = { file: string; message: string }

export type CatalogResult = { games: GameDefinition[]; errors: CatalogError[] }

export type ProcessState = 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed'

export type ServerStatus = 'not-installed' | 'installing' | 'updating' | ProcessState

export interface ServerView {
  id: string
  name: string
  gameId: string
  gameName: string
  installDir: string
  ports: Record<string, number>
  settings: Record<string, string>
  status: ServerStatus
  progress?: number
  message?: string
  /** False where NeledPort cannot ask the server to save before stopping (signal-only games on Windows). */
  gracefulStop: boolean
}

export interface CreateServerInput {
  gameId: string
  name: string
  installDir?: string
  ports?: Record<string, number>
  settings: Record<string, string>
}

export type BackupReason = 'manual' | 'update' | 'scheduled' | 'config' | 'stop'

export interface BackupInfo {
  file: string
  reason: BackupReason
  createdAt: string
  size: number
}

export interface AppInfo {
  platform: Platform
  /** False on macOS, where game servers cannot run (UI development only). */
  canHostServers: boolean
  serversDir: string
  loadError?: string
}

export type ServerAction = 'install' | 'start' | 'stop' | 'restart' | 'update' | 'backup' | 'remove' | 'openFolder'

/** What the preload script exposes to the renderer as `window.neledport`. */
export interface NeledPortApi {
  appInfo(): Promise<AppInfo>
  listGames(): Promise<CatalogResult>
  listServers(): Promise<ServerView[]>
  createServer(input: CreateServerInput): Promise<ServerView>
  serverAction(action: ServerAction, id: string): Promise<void>
  serverLines(id: string): Promise<string[]>
  serverBackups(id: string): Promise<BackupInfo[]>
  onServerChanged(cb: (server: ServerView) => void): () => void
  onServerLine(cb: (id: string, line: string) => void): () => void
}
