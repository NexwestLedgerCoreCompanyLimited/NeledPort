import { useEffect, useState } from 'react'
import type { CatalogResult, GameDefinition } from '../../core/types'
import { version } from '../../../package.json'

const REPO_URL = 'https://github.com/NEXWEST-LEDGER-CORE/NeledPort'

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="h-9 w-9" aria-hidden="true">
      <defs>
        <linearGradient id="np-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <path d="M16 2 28 9v14l-12 7-12-7V9z" fill="none" stroke="url(#np-logo)" strokeWidth="2" />
      <path d="M11 21V11l10 10V11" fill="none" stroke="url(#np-logo)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Sidebar() {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-white/5 bg-ink-900/80 backdrop-blur">
      <div className="flex items-center gap-3 px-5 py-5">
        <Logo />
        <div>
          <div className="font-semibold tracking-wide text-white">NeledPort</div>
          <div className="font-mono text-[11px] text-slate-500">v{version} · preview</div>
        </div>
      </div>

      <div className="px-4">
        <button
          type="button"
          disabled
          title="Coming in the next milestone"
          className="w-full rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm font-medium text-accent opacity-60"
        >
          + Add server
        </button>
      </div>

      <nav aria-label="Servers" className="mt-6 flex-1 px-4">
        <h2 className="px-1 text-[11px] font-semibold tracking-[0.2em] text-slate-500 uppercase">Servers</h2>
        <div className="mt-3 rounded-lg border border-dashed border-white/10 px-4 py-6 text-center text-sm text-slate-500">
          No servers yet.
          <br />
          Pick a game to get started.
        </div>
      </nav>

      <footer className="border-t border-white/5 px-5 py-4 text-xs text-slate-500">
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="rounded hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        >
          ★ Star on GitHub
        </a>
      </footer>
    </aside>
  )
}

const tierStyle: Record<GameDefinition['tier'], string> = {
  full: 'border-accent/40 bg-accent/15 text-accent',
  basic: 'border-slate-500/40 bg-slate-500/15 text-slate-300',
  custom: 'border-accent-2/40 bg-accent-2/15 text-accent-2'
}

function GameCard({ game }: { game: GameDefinition }) {
  const [coverFailed, setCoverFailed] = useState(false)
  const cover = game.gameAppId && !coverFailed
    ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.gameAppId}/header.jpg`
    : null

  return (
    <article className="group overflow-hidden rounded-xl border border-white/5 bg-ink-900 transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-[0_8px_32px_-8px_rgb(34_211_238_/_0.35)]">
      <div className="relative aspect-[460/215] bg-ink-800">
        {cover && (
          <img
            src={cover}
            alt=""
            loading="lazy"
            onError={() => setCoverFailed(true)}
            className="h-full w-full object-cover opacity-85 transition group-hover:opacity-100"
          />
        )}
        <div className="absolute inset-0 bg-linear-to-t from-ink-900 via-ink-900/10 to-transparent" />
        <span
          className={`absolute top-3 right-3 rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-widest uppercase ${tierStyle[game.tier]}`}
        >
          {game.tier}
        </span>
      </div>
      <div className="space-y-3 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="truncate font-semibold text-white">{game.name}</h3>
          <span className="shrink-0 font-mono text-[11px] text-slate-500">App {game.serverAppId}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Object.keys(game.platforms).map((p) => (
            <span key={p} className="rounded bg-ink-700 px-1.5 py-0.5 text-[11px] text-slate-300 capitalize">
              {p}
            </span>
          ))}
          {game.ports.map((port) => (
            <span key={port.name} className="rounded bg-ink-700 px-1.5 py-0.5 font-mono text-[11px] text-slate-400">
              {port.default}/{port.protocol}
            </span>
          ))}
        </div>
      </div>
    </article>
  )
}

export default function App() {
  const [catalog, setCatalog] = useState<CatalogResult | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    window.neledport.listGames().then(setCatalog, (e: Error) => setLoadError(e.message))
  }, [])

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="grid-bg flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-8 py-8">
          <header className="mb-8">
            <p className="font-mono text-xs tracking-[0.3em] text-accent uppercase">Catalog</p>
            <h1 className="mt-1 text-3xl font-semibold text-white">Choose a game server</h1>
            <p className="mt-2 text-sm text-slate-400">
              {catalog
                ? `${catalog.games.length} game${catalog.games.length === 1 ? '' : 's'} ready, more on the way.`
                : 'Loading catalog…'}
            </p>
          </header>

          {loadError && (
            <div role="alert" className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
              Could not load the game catalog: {loadError}
            </div>
          )}

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

          <section aria-label="Games" className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {catalog?.games.map((game) => <GameCard key={game.id} game={game} />)}
          </section>
        </div>
      </main>
    </div>
  )
}
