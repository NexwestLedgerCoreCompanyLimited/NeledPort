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

/** What the preload script exposes to the renderer as `window.neledport`. */
export interface NeledPortApi {
  listGames(): Promise<CatalogResult>
}
