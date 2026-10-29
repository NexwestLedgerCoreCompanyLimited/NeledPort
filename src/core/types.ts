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
  $schema?: string
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
    port?: string
  }
  players?: { source: 'rest' | 'rcon' | 'a2s' | 'log'; port?: string }
  bans?: { method: 'rest' | 'rcon' | 'file'; file?: string; format?: 'lines' | 'rust-cfg' }
  logPatterns?: { ready?: string; join?: string; leave?: string; character?: string }
  workshop?: { command: string } | null
  modLoaders?: ModLoaderDefinition[]
}

export interface ModLoaderDefinition {
  id: string
  name: string
  download: Partial<Record<Platform, string>>
  stripTopFolder?: string
  pluginDir: string
  pluginExtensions: string[]
  reapplyAfterUpdate?: boolean
  env?: Partial<Record<Platform, Record<string, string>>>
}

export type CatalogError = { file: string; message: string }

export type CatalogResult = { games: GameDefinition[]; errors: CatalogError[] }

export interface PlayerInfo {
  /** Steam/platform id where the game gives one, otherwise the player name. */
  id: string
  name: string
  ping?: number
  seconds?: number
}

export interface BanEntry {
  id: string
  name?: string
  reason?: string
}

/** What a server's remote control supports, so the UI can show only working buttons. */
export interface AdminCapabilities {
  players: boolean
  kick: boolean
  ban: boolean
  unban: boolean
  command: boolean
  /** Bans apply on the next join only (the game cannot kick). */
  banOnNextJoin: boolean
}

export interface LoaderInfo {
  id: string
  name: string
  installed: boolean
  installedAt?: string
}

export interface PluginInfo {
  name: string
  enabled: boolean
  size: number
}

export interface BuildInfo {
  installed?: string
  latest?: string
  updateAvailable: boolean
  error?: string
}

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
  admin: AdminCapabilities
  build: BuildInfo
  /** No launcher is known for this OS: the user picks the server program once after installing. */
  needsLaunchSetup: boolean
  custom: boolean
  loaders: LoaderInfo[]
  /** Workshop items can be loaded through the console. */
  workshop: boolean
  launch?: { executable: string; args: string[] }
}

export interface CreateServerInput {
  gameId: string
  name: string
  installDir?: string
  ports?: Record<string, number>
  settings: Record<string, string>
  /** gameId "custom": any SteamCMD App ID that is not in the catalog. */
  custom?: { appId: number; name: string }
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

/** App self-update from GitHub Releases. 'none' also covers dev builds, .deb installs and failed checks. */
export type UpdateState = { status: 'none' } | { status: 'downloading'; version: string; percent: number } | { status: 'ready'; version: string }

export type ServerAction = 'install' | 'start' | 'stop' | 'restart' | 'update' | 'backup' | 'remove' | 'openFolder'

/** What the preload script exposes to the renderer as `window.neledport`. */
export interface NeledPortApi {
  appInfo(): Promise<AppInfo>
  setLanguage(lang: string): Promise<void>
  updateState(): Promise<UpdateState>
  /** Stops running servers (they save first), then restarts NeledPort into the downloaded update. */
  installUpdate(): Promise<void>
  onUpdateChanged(cb: (state: UpdateState) => void): () => void
  listGames(): Promise<CatalogResult>
  listServers(): Promise<ServerView[]>
  createServer(input: CreateServerInput): Promise<ServerView>
  serverAction(action: ServerAction, id: string): Promise<void>
  serverLines(id: string): Promise<string[]>
  serverBackups(id: string): Promise<BackupInfo[]>
  players(id: string): Promise<PlayerInfo[]>
  kick(id: string, player: PlayerInfo): Promise<void>
  ban(id: string, player: PlayerInfo, reason?: string): Promise<void>
  unban(id: string, banId: string): Promise<void>
  bans(id: string): Promise<BanEntry[]>
  command(id: string, text: string): Promise<string>
  checkBuild(id: string): Promise<BuildInfo>
  /** Steam dedicated servers that are not in the catalog yet, for the any-App-ID search. */
  steamServers(): Promise<{ appId: number; name: string }[]>
  pickProgram(id: string): Promise<string | null>
  setLaunch(id: string, program: string, args: string): Promise<ServerView>
  /** Opens a prefilled GitHub pull request page with this server's definition; returns its URL. */
  shareDefinition(id: string): Promise<string>
  installLoader(id: string, loaderId: string): Promise<void>
  uninstallLoader(id: string, loaderId: string): Promise<void>
  plugins(id: string, loaderId: string): Promise<PluginInfo[]>
  setPluginEnabled(id: string, loaderId: string, name: string, enabled: boolean): Promise<void>
  removePlugin(id: string, loaderId: string, name: string): Promise<void>
  /** Opens a file picker; false when the user cancelled. */
  addPlugin(id: string, loaderId: string): Promise<boolean>
  workshop(id: string, itemId: string): Promise<void>
  onServerChanged(cb: (server: ServerView) => void): () => void
  onServerLine(cb: (id: string, line: string) => void): () => void
}
