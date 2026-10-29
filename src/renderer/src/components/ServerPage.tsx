import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppInfo, BackupInfo, GameDefinition, ServerAction, ServerView } from '../../../core/types'
import { coverUrl, statusDot, statusLabel } from '../status'

const MAX_LINES = 2000

const button = {
  primary: 'bg-accent text-ink-950 font-semibold hover:bg-cyan-300',
  danger: 'border border-red-400/50 text-red-300 hover:bg-red-500/10',
  plain: 'border border-white/10 bg-ink-900 text-slate-100 hover:bg-ink-800'
}

interface Props {
  server: ServerView
  game?: GameDefinition
  info: AppInfo | null
  onRemoved: () => void
}

export function ServerPage({ server, game, info, onRemoved }: Props) {
  const [tab, setTab] = useState<'overview' | 'console'>('overview')
  const [error, setError] = useState<string | null>(null)
  const canHost = !!info?.canHostServers

  async function act(action: ServerAction) {
    if (action === 'remove' && !window.confirm(`Remove "${server.name}" from NeledPort? Its files stay on disk.`)) return
    setError(null)
    try {
      await window.neledport.serverAction(action, server.id)
      if (action === 'remove') onRemoved()
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  const s = server.status
  const busy = s === 'installing' || s === 'updating' || s === 'stopping' || s === 'starting'
  const actions: { action: ServerAction; label: string; kind: keyof typeof button; hostOnly?: boolean }[] =
    s === 'not-installed'
      ? [
          { action: 'install', label: 'Install', kind: 'primary', hostOnly: true },
          { action: 'remove', label: 'Remove', kind: 'plain' }
        ]
      : s === 'running'
        ? [
            { action: 'stop', label: 'Stop', kind: 'danger' },
            { action: 'restart', label: 'Restart', kind: 'plain' },
            { action: 'update', label: 'Update', kind: 'plain', hostOnly: true },
            { action: 'backup', label: 'Back up now', kind: 'plain' }
          ]
        : busy
          ? []
          : [
              { action: 'start', label: 'Start', kind: 'primary', hostOnly: true },
              { action: 'update', label: 'Update', kind: 'plain', hostOnly: true },
              { action: 'backup', label: 'Back up now', kind: 'plain' },
              { action: 'openFolder', label: 'Open folder', kind: 'plain' },
              { action: 'remove', label: 'Remove', kind: 'plain' }
            ]

  return (
    <div className="mx-auto flex max-w-6xl flex-col px-10 py-7">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          {coverUrl(game?.gameAppId) && <img src={coverUrl(game?.gameAppId)!} alt="" className="h-[45px] w-24 rounded-lg border border-white/5 object-cover" />}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="truncate text-2xl font-semibold text-white">{server.name}</h1>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-0.5 text-xs font-medium text-slate-200">
                <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${statusDot[s]}`} />
                {statusLabel[s]}
                {server.progress !== undefined && ` · ${Math.floor(server.progress)}%`}
              </span>
            </div>
            <div className="mt-1 truncate font-mono text-xs text-slate-400">
              {server.gameName} · {server.installDir}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <button
              key={a.action}
              type="button"
              onClick={() => void act(a.action)}
              disabled={a.hostOnly && !canHost}
              title={a.hostOnly && !canHost ? 'Game servers run on Windows and Linux only' : undefined}
              className={`min-h-10 rounded-[10px] px-4 text-[13px] disabled:cursor-not-allowed disabled:opacity-50 ${button[a.kind]}`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </header>

      <nav aria-label="Server sections" className="mt-5 flex gap-1 border-b border-white/5">
        {(['overview', 'console'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-current={tab === t ? 'page' : undefined}
            className={`min-h-11 border-b-2 px-3.5 text-sm capitalize ${tab === t ? 'border-accent font-medium text-white' : 'border-transparent text-slate-300 hover:text-white'}`}
          >
            {t}
          </button>
        ))}
      </nav>

      {(error || server.message) && (
        <p role="alert" className="mt-5 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {error ?? server.message}
        </p>
      )}

      {tab === 'overview' ? <Overview server={server} game={game} /> : <Console id={server.id} />}
    </div>
  )
}

function Overview({ server, game }: { server: ServerView; game?: GameDefinition }) {
  const [backups, setBackups] = useState<BackupInfo[]>([])
  useEffect(() => {
    void window.neledport.serverBackups(server.id).then(setBackups)
  }, [server.id, server.status])

  const localOnly = new Set([game?.control?.rest?.port].filter(Boolean))
  return (
    <div className="mt-5 grid gap-4 md:grid-cols-[3fr_2fr]">
      <section className="flex flex-col gap-4 rounded-[14px] border border-white/5 bg-ink-900 p-5">
        <h2 className="font-semibold text-white">Status</h2>
        {server.progress !== undefined ? (
          <div>
            <div className="mb-2 flex justify-between text-sm">
              <span>{server.status === 'updating' ? 'Updating server files' : 'Downloading server files'}</span>
              <span className="font-mono text-accent">{Math.floor(server.progress)}%</span>
            </div>
            <div role="progressbar" aria-valuenow={Math.floor(server.progress)} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-ink-700">
              <div className="h-full bg-accent transition-all" style={{ width: `${server.progress}%` }} />
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-300">{describe(server)}</p>
        )}
        {!server.gracefulStop && (
          <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">
            On Windows, {server.gameName} cannot be asked to save before it stops. NeledPort backs up the world first, but save in-game before stopping to be safe.
          </p>
        )}
        <div>
          <h3 className="mb-2 text-xs font-semibold tracking-[0.1em] text-slate-400 uppercase">Recent backups</h3>
          {backups.length === 0 ? (
            <p className="text-sm text-slate-400">No backups yet. One is made before every update.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {backups.slice(0, 5).map((b) => (
                <li key={b.file} className="flex justify-between gap-3 border-b border-white/5 py-1.5 last:border-0">
                  <span>{new Date(b.createdAt).toLocaleString()}</span>
                  <span className="text-slate-400">
                    {b.reason} · {(b.size / 1024 / 1024).toFixed(1)} MB
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-[14px] border border-white/5 bg-ink-900 p-5">
        <h2 className="font-semibold text-white">Ports</h2>
        <p className="text-sm text-slate-300">Open these on your router so friends can join.</p>
        <table className="w-full text-sm">
          <tbody>
            {(game?.ports ?? []).map((p) => (
              <tr key={p.name} className="border-b border-white/5 last:border-0">
                <td className="py-1.5 font-mono text-white">{server.ports[p.name]}</td>
                <td className="text-slate-300">{p.protocol.toUpperCase()}</td>
                <td className="text-right text-slate-300 capitalize">{localOnly.has(p.name) ? `${p.name} · keep local` : p.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function describe(server: ServerView): string {
  switch (server.status) {
    case 'not-installed':
      return 'Not installed yet. Install downloads the dedicated server from Steam.'
    case 'running':
      return 'Running. Players can join now.'
    case 'starting':
      return 'Starting up…'
    case 'stopping':
      return 'Saving the world and shutting down…'
    case 'crashed':
      return 'The server stopped unexpectedly. Check the console, then start it again.'
    default:
      return 'Stopped.'
  }
}

function Console({ id }: { id: string }) {
  const [lines, setLines] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [follow, setFollow] = useState(true)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.neledport.serverLines(id).then(setLines)
    return window.neledport.onServerLine((lineId, line) => {
      if (lineId === id) setLines((prev) => [...prev.slice(-(MAX_LINES - 1)), line])
    })
  }, [id])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (q ? lines.filter((l) => l.toLowerCase().includes(q)) : lines).slice(-500)
  }, [lines, query])

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [shown, follow])

  return (
    <div className="mt-5 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-h-10 flex-1 items-center rounded-[10px] border border-white/10 bg-ink-900 px-3">
          <span className="sr-only">Search log</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search log"
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="h-4 w-4 accent-cyan-400" />
          Auto-scroll
        </label>
      </div>
      <div
        ref={box}
        role="log"
        aria-label="Server log"
        className="h-[460px] overflow-auto rounded-[14px] border border-white/5 bg-[#05070c] px-4 py-3 font-mono text-[12.5px] leading-relaxed text-slate-300 select-text"
      >
        {shown.length === 0 ? (
          <p className="text-slate-500">Nothing here yet. Output appears when the server installs or runs.</p>
        ) : (
          shown.map((line, i) => (
            <div key={i} className={`whitespace-pre-wrap ${/error|exception|fail/i.test(line) ? 'text-red-300' : /warn/i.test(line) ? 'text-amber-200' : line.startsWith('[NeledPort]') ? 'text-accent' : ''}`}>
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
