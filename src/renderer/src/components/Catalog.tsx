import { useState } from 'react'
import type { AppInfo, CatalogResult, GameDefinition, ServerView } from '../../../core/types'
import { useT } from '../i18n'
import { coverUrl } from '../status'

const tierStyle: Record<GameDefinition['tier'], string> = {
  full: 'border-accent/50 text-accent',
  basic: 'border-slate-400/50 text-slate-300',
  custom: 'border-accent-2/50 text-accent-2'
}

type Filter = 'all' | 'full' | 'basic'

function GameCard({ game, info, installed, onPick }: { game: GameDefinition; info: AppInfo | null; installed: number; onPick: () => void }) {
  const t = useT()
  const [coverFailed, setCoverFailed] = useState(false)
  const cover = coverFailed ? null : coverUrl(game.gameAppId)
  const needsLogin = !game.anonymous
  const noLauncher = !!info && !game.platforms[info.platform]
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={needsLogin}
      title={needsLogin ? t('catalog.needsLoginTitle') : t('catalog.create', { game: game.name })}
      className="group flex flex-col overflow-hidden rounded-[14px] border border-white/5 bg-ink-900 text-left transition hover:-translate-y-0.5 hover:border-accent/40 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
    >
      <div className="relative aspect-[460/215] bg-ink-800">
        {cover ? (
          <img src={cover} alt="" loading="lazy" onError={() => setCoverFailed(true)} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center p-3 text-center text-lg font-semibold text-slate-300">{game.name}</div>
        )}
        <span className={`absolute top-2.5 right-2.5 rounded-full border bg-ink-950/80 px-2 py-0.5 font-mono text-[10px] tracking-widest uppercase ${tierStyle[game.tier]}`}>
          {t(`tier.${game.tier}`)}
        </span>
        {installed > 0 && (
          <span className="absolute top-2.5 left-2.5 rounded-full bg-ink-950/80 px-2 py-0.5 text-[11px] font-medium text-emerald-400">{t('catalog.added', { count: installed })}</span>
        )}
      </div>
      <div className="flex flex-col gap-1.5 p-3.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-semibold text-white">{game.name}</span>
          <span className="shrink-0 font-mono text-[11px] text-slate-400">{game.serverAppId}</span>
        </div>
        <span className="text-[11px] text-slate-400">
          {needsLogin ? t('catalog.needsLogin') : noLauncher ? t('catalog.pickProgram') : Object.keys(game.platforms).join(' · ')}
        </span>
      </div>
    </button>
  )
}

interface Props {
  info: AppInfo | null
  catalog: CatalogResult | null
  servers: ServerView[]
  onPick: (game: GameDefinition) => void
  onCustom: () => void
}

export function Catalog({ info, catalog, servers, onPick, onCustom }: Props) {
  const t = useT()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const all = catalog?.games ?? []
  const games = all
    .filter((g) => filter === 'all' || g.tier === filter)
    .filter((g) => {
      const q = query.trim().toLowerCase()
      return !q || g.name.toLowerCase().includes(q) || String(g.serverAppId).includes(q)
    })
    // Fully supported games first, then alphabetical.
    .sort((a, b) => Number(b.tier === 'full') - Number(a.tier === 'full') || a.name.localeCompare(b.name))

  const chip = (f: Filter, label: string) => (
    <button
      type="button"
      onClick={() => setFilter(f)}
      aria-pressed={filter === f}
      className={`min-h-9 rounded-full border px-3.5 text-[13px] ${filter === f ? 'border-accent/50 bg-accent/10 text-accent' : 'border-white/10 text-slate-300 hover:bg-ink-800'}`}
    >
      {label} <span className="text-slate-400">{f === 'all' ? all.length : all.filter((g) => g.tier === f).length}</span>
    </button>
  )

  return (
    <div className="mx-auto max-w-6xl px-10 py-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="font-mono text-xs tracking-[0.3em] text-accent uppercase">{t('catalog.eyebrow')}</p>
          <h1 className="mt-1 text-3xl font-semibold text-white">{t('catalog.title')}</h1>
          <p className="mt-2 text-sm text-slate-300">{t('catalog.intro')}</p>
        </div>
        <label className="flex min-h-11 w-72 max-w-full items-center rounded-[10px] border border-white/10 bg-ink-900 px-3">
          <span className="sr-only">{t('catalog.search')}</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('catalog.search')}
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
        </label>
      </header>

      <div role="group" aria-label={t('catalog.filter')} className="mb-6 flex flex-wrap gap-2">
        {chip('all', t('catalog.all'))}
        {chip('full', t('catalog.full'))}
        {chip('basic', t('catalog.basic'))}
      </div>

      {catalog && catalog.errors.length > 0 && (
        <div role="alert" className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          <p className="font-medium">{t('catalog.skipped')}</p>
          <ul className="mt-2 space-y-1 font-mono text-xs">
            {catalog.errors.map((e) => (
              <li key={e.file}>
                {e.file}: {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <section aria-label={t('catalog.games')} className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4">
        <button
          type="button"
          onClick={onCustom}
          className="flex min-h-[180px] flex-col items-center justify-center gap-1.5 rounded-[14px] border border-dashed border-accent-2/50 p-4 text-center text-accent-2 hover:bg-accent-2/5 focus-visible:ring-2 focus-visible:ring-accent-2 focus-visible:outline-none"
        >
          <span className="text-2xl leading-none">+</span>
          <span className="text-sm font-semibold">{t('catalog.anyAppId')}</span>
          <span className="text-xs text-slate-300">{t('catalog.anyAppIdHint')}</span>
        </button>
        {games.map((game) => (
          <GameCard key={game.id} game={game} info={info} installed={servers.filter((s) => s.gameId === game.id).length} onPick={() => onPick(game)} />
        ))}
      </section>
      {catalog && games.length === 0 && <p className="mt-10 text-center text-slate-400">{t('catalog.noMatch', { query })}</p>}
    </div>
  )
}
