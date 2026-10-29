import { useState } from 'react'
import type { AppInfo, CatalogResult, GameDefinition, ServerView } from '../../../core/types'
import { coverUrl } from '../status'

const tierStyle: Record<GameDefinition['tier'], string> = {
  full: 'border-accent/50 text-accent',
  basic: 'border-slate-500/50 text-slate-300',
  custom: 'border-accent-2/50 text-accent-2'
}

function GameCard({ game, installed, available, onPick }: { game: GameDefinition; installed: number; available: boolean; onPick: () => void }) {
  const [coverFailed, setCoverFailed] = useState(false)
  const cover = coverFailed ? null : coverUrl(game.gameAppId)
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={!available}
      title={available ? `Create a ${game.name} server` : 'No dedicated server for this operating system'}
      className="group flex flex-col overflow-hidden rounded-[14px] border border-white/5 bg-ink-900 text-left transition hover:-translate-y-0.5 hover:border-accent/40 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
    >
      <div className="relative aspect-[460/215] bg-ink-800">
        {cover && <img src={cover} alt="" loading="lazy" onError={() => setCoverFailed(true)} className="h-full w-full object-cover" />}
        <span className={`absolute top-2.5 right-2.5 rounded-full border bg-ink-950/80 px-2 py-0.5 font-mono text-[10px] tracking-widest uppercase ${tierStyle[game.tier]}`}>
          {game.tier}
        </span>
        {installed > 0 && (
          <span className="absolute top-2.5 left-2.5 rounded-full bg-ink-950/80 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
            {installed} added
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-semibold text-white">{game.name}</span>
          <span className="shrink-0 font-mono text-[11px] text-slate-400">App {game.serverAppId}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Object.keys(game.platforms).map((p) => (
            <span key={p} className="rounded-md bg-ink-700 px-1.5 py-0.5 text-[11px] text-slate-300 capitalize">
              {p}
            </span>
          ))}
        </div>
      </div>
    </button>
  )
}

interface Props {
  info: AppInfo | null
  catalog: CatalogResult | null
  servers: ServerView[]
  onPick: (game: GameDefinition) => void
}

export function Catalog({ info, catalog, servers, onPick }: Props) {
  const [query, setQuery] = useState('')
  const games = (catalog?.games ?? []).filter((g) => {
    const q = query.trim().toLowerCase()
    return !q || g.name.toLowerCase().includes(q) || String(g.serverAppId).includes(q)
  })
  return (
    <div className="mx-auto max-w-6xl px-10 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="font-mono text-xs tracking-[0.3em] text-accent uppercase">Catalog</p>
          <h1 className="mt-1 text-3xl font-semibold text-white">Choose a game server</h1>
          <p className="mt-2 text-sm text-slate-300">Pick a game and NeledPort installs and runs the server for you.</p>
        </div>
        <label className="flex min-h-11 w-72 max-w-full items-center gap-2 rounded-[10px] border border-white/10 bg-ink-900 px-3">
          <span className="sr-only">Search games</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search games or App ID"
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
        </label>
      </header>

      {catalog && catalog.errors.length > 0 && (
        <div role="alert" className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          <p className="font-medium">Some game definitions were skipped:</p>
          <ul className="mt-2 space-y-1 font-mono text-xs">
            {catalog.errors.map((e) => (
              <li key={e.file}>
                {e.file}: {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <section aria-label="Games" className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-5">
        {games.map((game) => (
          <GameCard
            key={game.id}
            game={game}
            installed={servers.filter((s) => s.gameId === game.id).length}
            available={!!info && !!game.platforms[info.platform]}
            onPick={() => onPick(game)}
          />
        ))}
      </section>
      {catalog && games.length === 0 && <p className="mt-10 text-center text-slate-400">No games match “{query}”.</p>}
    </div>
  )
}
