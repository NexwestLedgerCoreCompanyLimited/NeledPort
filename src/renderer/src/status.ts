import type { ServerStatus } from '../../core/types'

export const statusLabel: Record<ServerStatus, string> = {
  'not-installed': 'Not installed',
  installing: 'Installing',
  updating: 'Updating',
  stopped: 'Stopped',
  starting: 'Starting',
  running: 'Running',
  stopping: 'Stopping',
  crashed: 'Crashed'
}

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
