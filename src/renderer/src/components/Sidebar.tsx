import type { ServerView } from '../../../core/types'
import { version } from '../../../../package.json'
import logo from '../assets/logo.png'
import { statusDot, statusLabel } from '../status'

const REPO_URL = 'https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort'

interface Props {
  servers: ServerView[]
  selected: string | null
  onSelect: (id: string | null) => void
}

export function Sidebar({ servers, selected, onSelect }: Props) {
  return (
    <aside className="flex w-64 shrink-0 flex-col gap-4 border-r border-white/5 bg-ink-900 px-3.5 py-5">
      <div className="flex items-center gap-3 px-1.5">
        <img src={logo} alt="" className="h-9 w-auto" />
        <div>
          <div className="font-semibold tracking-wide text-white">NeledPort</div>
          <div className="font-mono text-[11px] text-slate-400">v{version}</div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => onSelect(null)}
        className="min-h-11 rounded-[10px] bg-accent text-sm font-semibold text-ink-950 hover:bg-cyan-300 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
      >
        + Add server
      </button>

      <nav aria-label="Servers" className="flex flex-1 flex-col gap-1 overflow-y-auto">
        <h2 className="px-2 pt-1 pb-2 text-[11px] font-semibold tracking-[0.18em] text-slate-400 uppercase">Servers</h2>
        {servers.length === 0 && (
          <p className="rounded-lg border border-dashed border-white/10 px-4 py-6 text-center text-sm text-slate-400">
            No servers yet.
            <br />
            Pick a game to get started.
          </p>
        )}
        {servers.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s.id)}
            aria-current={selected === s.id ? 'page' : undefined}
            className={`flex min-h-11 items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${
              selected === s.id ? 'bg-ink-800 text-white' : 'text-slate-200 hover:bg-ink-800/60'
            }`}
          >
            <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${statusDot[s.status]}`} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[13px] font-medium">{s.name}</span>
              <span className="text-[11px] text-slate-400">
                {s.gameName} · {statusLabel[s.status]}
              </span>
            </span>
          </button>
        ))}
      </nav>

      <footer className="flex flex-col gap-1 border-t border-white/5 pt-3 text-[13px]">
        <button
          type="button"
          onClick={() => onSelect(null)}
          aria-current={selected === null ? 'page' : undefined}
          className={`min-h-10 rounded-[10px] px-2.5 text-left ${selected === null ? 'bg-ink-800 text-white' : 'text-slate-300 hover:bg-ink-800/60'}`}
        >
          Game catalog
        </button>
        <a href={REPO_URL} target="_blank" rel="noreferrer" className="rounded-[10px] px-2.5 py-2 text-slate-400 hover:text-accent">
          ★ Star on GitHub
        </a>
      </footer>
    </aside>
  )
}
