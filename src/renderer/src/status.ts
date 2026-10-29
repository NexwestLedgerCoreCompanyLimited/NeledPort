import type { ServerStatus } from '../../core/types'

/** Dot classes; status is always shown with text too, never by colour alone. */
export const statusDot: Record<ServerStatus, string> = {
  'not-installed': 'border-2 border-slate-500',
  installing: 'bg-amber-400 animate-pulse',
  updating: 'bg-amber-400 animate-pulse',
  stopped: 'bg-slate-500',
  starting: 'bg-amber-400 animate-pulse',
  running: 'bg-emerald-400',
  stopping: 'bg-amber-400 animate-pulse',
  crashed: 'bg-red-400'
}

export const coverUrl = (gameAppId?: number): string | null =>
  gameAppId ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${gameAppId}/header.jpg` : null

/** Electron wraps errors from the main process; show only the useful part. */
export const cleanError = (e: unknown): string =>
  (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
