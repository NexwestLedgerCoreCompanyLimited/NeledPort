import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { AppInfo, BackupInfo, GameDefinition, ServerAction, ServerView } from '../../../core/types'
import { useLanguage, useT } from '../i18n'
import { cleanError, coverUrl, statusDot } from '../status'
import { Backups } from './Backups'
import { Config } from './Config'
import { Mods } from './Mods'
import { Players } from './Players'
import { SteamAccount } from './SteamAccount'

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
  const t = useT()
  const [tab, setTab] = useState<'overview' | 'console' | 'players' | 'mods' | 'config' | 'backups'>('overview')
  const [error, setError] = useState<string | null>(null)
  const canHost = !!info?.canHostServers
  const configFiles = !!(info && game?.platforms[info.platform]?.configFiles?.length)
  const tabs = ['overview', 'console', 'players', 'mods', ...(game?.settings?.length || configFiles ? (['config'] as const) : []), 'backups'] as const

  async function act(action: ServerAction) {
    if (action === 'remove' && !window.confirm(t('server.removeConfirm', { name: server.name }))) return
    setError(null)
    try {
      await window.neledport.serverAction(action, server.id)
      if (action === 'remove') onRemoved()
    } catch (e) {
      setError(cleanError(e))
    }
  }

  const s = server.status
  const busy = s === 'installing' || s === 'updating' || s === 'stopping' || s === 'starting'
  const actions: { action: ServerAction; label: string; kind: keyof typeof button; hostOnly?: boolean }[] =
    s === 'not-installed'
      ? [
          { action: 'install', label: t('action.install'), kind: 'primary', hostOnly: true },
          { action: 'remove', label: t('action.remove'), kind: 'plain' }
        ]
      : s === 'running'
        ? [
            { action: 'stop', label: t('action.stop'), kind: 'danger' },
            { action: 'restart', label: t('action.restart'), kind: 'plain' },
            { action: 'update', label: t('action.update'), kind: 'plain', hostOnly: true },
            { action: 'backup', label: t('action.backup'), kind: 'plain' }
          ]
        : busy
          ? []
          : [
              { action: 'start', label: t('action.start'), kind: 'primary', hostOnly: true },
              { action: 'update', label: t('action.update'), kind: 'plain', hostOnly: true },
              { action: 'backup', label: t('action.backup'), kind: 'plain' },
              { action: 'openFolder', label: t('action.openFolder'), kind: 'plain' },
              { action: 'remove', label: t('action.remove'), kind: 'plain' }
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
                {t(`status.${s}`)}
                {server.progress !== undefined && ` · ${Math.floor(server.progress)}%`}
              </span>
            </div>
            <div className="mt-1 truncate font-mono text-xs text-slate-400">
              {server.gameName} · {server.installDir}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* The Backups tab has its own button, which also refreshes its list. */}
          {actions.filter((a) => !(tab === 'backups' && a.action === 'backup')).map((a) => (
            <button
              key={a.action}
              type="button"
              onClick={() => void act(a.action)}
              disabled={a.hostOnly && !canHost}
              title={a.hostOnly && !canHost ? t('server.hostOnly') : undefined}
              className={`min-h-10 rounded-[10px] px-4 text-[13px] disabled:cursor-not-allowed disabled:opacity-50 ${button[a.kind]}`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </header>

      <nav aria-label={t('server.sections')} className="mt-5 flex gap-1 border-b border-white/5">
        {tabs.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            aria-current={tab === name ? 'page' : undefined}
            className={`min-h-11 border-b-2 px-3.5 text-sm ${tab === name ? 'border-accent font-medium text-white' : 'border-transparent text-slate-300 hover:text-white'}`}
          >
            {t(`tab.${name}`)}
          </button>
        ))}
      </nav>

      {(error || server.message) && (
        <p role="alert" className="mt-5 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {error ?? server.message}
        </p>
      )}

      {tab === 'overview' && <Overview server={server} game={game} />}
      {tab === 'console' && <Console server={server} />}
      {tab === 'players' && <Players server={server} />}
      {tab === 'mods' && <Mods server={server} />}
      {tab === 'config' && game && <Config server={server} game={game} configFiles={configFiles} />}
      {tab === 'backups' && <Backups server={server} game={game} />}
    </div>
  )
}

function Overview({ server, game }: { server: ServerView; game?: GameDefinition }) {
  const t = useT()
  const lang = useLanguage()
  const [backups, setBackups] = useState<BackupInfo[]>([])
  useEffect(() => {
    void window.neledport.serverBackups(server.id).then(setBackups)
  }, [server.id, server.status])

  const localOnly = new Set([game?.control?.rest?.port, game?.control?.port].filter(Boolean))
  return (
    <div className="mt-5 grid gap-4 md:grid-cols-[3fr_2fr]">
      <section className="flex flex-col gap-4 rounded-[14px] border border-white/5 bg-ink-900 p-5">
        <h2 className="font-semibold text-white">{t('overview.status')}</h2>
        {server.progress !== undefined ? (
          <div>
            <div className="mb-2 flex justify-between text-sm">
              <span>{server.status === 'updating' ? t('overview.updating') : t('overview.downloading')}</span>
              <span className="font-mono text-accent">{Math.floor(server.progress)}%</span>
            </div>
            <div role="progressbar" aria-valuenow={Math.floor(server.progress)} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-ink-700">
              <div className="h-full bg-accent transition-all" style={{ width: `${server.progress}%` }} />
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-300">{t(`describe.${server.status}`)}</p>
        )}
        {!server.gracefulStop && (
          <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">
            {t('overview.noGracefulStop', { game: server.gameName })}
          </p>
        )}
        {game && !game.anonymous && <SteamAccount game={game.name} />}
        <LaunchSetup server={server} />
        <BuildLine server={server} />
        <div>
          <h3 className="mb-2 text-xs font-semibold tracking-[0.1em] text-slate-400 uppercase">{t('overview.backups')}</h3>
          {backups.length === 0 ? (
            <p className="text-sm text-slate-400">{t('overview.noBackups')}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {backups.slice(0, 5).map((b) => (
                <li key={b.file} className="flex justify-between gap-3 border-b border-white/5 py-1.5 last:border-0">
                  <span>{new Date(b.createdAt).toLocaleString(lang)}</span>
                  <span className="text-slate-400">
                    {t(`backup.${b.reason}`)} · {(b.size / 1024 / 1024).toFixed(1)} MB
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-[14px] border border-white/5 bg-ink-900 p-5">
        <h2 className="font-semibold text-white">{t('overview.ports')}</h2>
        <p className="text-sm text-slate-300">{t('overview.portsHint')}</p>
        <table className="w-full text-sm">
          <tbody>
            {(game?.ports ?? Object.keys(server.ports).map((name) => ({ name, protocol: 'udp' as const }))).map((p) => (
              <tr key={p.name} className="border-b border-white/5 last:border-0">
                <td className="py-1.5 font-mono text-white">{server.ports[p.name]}</td>
                <td className="text-slate-300">{p.protocol.toUpperCase()}</td>
                <td className="text-right text-slate-300 capitalize">{localOnly.has(p.name) ? t('overview.keepLocal', { name: p.name }) : p.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function Console({ server }: { server: ServerView }) {
  const t = useT()
  const id = server.id
  const [lines, setLines] = useState<string[]>([])
  const [cmd, setCmd] = useState('')
  const [cmdError, setCmdError] = useState<string | null>(null)
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

  async function send(e: FormEvent) {
    e.preventDefault()
    const text = cmd.trim()
    if (!text) return
    setCmdError(null)
    try {
      await window.neledport.command(id, text)
      setCmd('')
    } catch (err) {
      setCmdError(cleanError(err))
    }
  }

  return (
    <div className="mt-5 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-h-10 flex-1 items-center rounded-[10px] border border-white/10 bg-ink-900 px-3">
          <span className="sr-only">{t('console.search')}</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('console.search')}
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="h-4 w-4 accent-cyan-400" />
          {t('console.follow')}
        </label>
      </div>
      <div
        ref={box}
        role="log"
        aria-label={t('console.log')}
        className="h-[460px] overflow-auto rounded-[14px] border border-white/5 bg-[#05070c] px-4 py-3 font-mono text-[12.5px] leading-relaxed text-slate-300 select-text"
      >
        {shown.length === 0 ? (
          <p className="text-slate-500">{t('console.empty')}</p>
        ) : (
          shown.map((line, i) => (
            <div key={i} className={`whitespace-pre-wrap ${/error|exception|fail/i.test(line) ? 'text-red-300' : /warn/i.test(line) ? 'text-amber-200' : line.startsWith('[NeledPort]') ? 'text-accent' : ''}`}>
              {line}
            </div>
          ))
        )}
      </div>
      {server.admin.command && (
        <form onSubmit={send} className="flex gap-2">
          <label className="flex min-h-11 flex-1 items-center gap-2.5 rounded-xl border border-accent/40 bg-ink-900 px-3.5">
            <span aria-hidden="true" className="font-mono text-accent">›</span>
            <span className="sr-only">{t('console.command')}</span>
            <input
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              disabled={server.status !== 'running'}
              maxLength={500}
              placeholder={server.status === 'running' ? t('console.placeholder') : t('console.startFirst')}
              className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-slate-100 placeholder:text-slate-500 focus:outline-none disabled:opacity-60"
            />
          </label>
          <button type="submit" disabled={server.status !== 'running'} className="min-h-11 rounded-xl bg-accent px-5 text-sm font-semibold text-ink-950 hover:bg-cyan-300 disabled:opacity-50">
            {t('console.send')}
          </button>
        </form>
      )}
      {cmdError && <p role="alert" className="text-sm text-red-300">{cmdError}</p>}
    </div>
  )
}

function LaunchSetup({ server }: { server: ServerView }) {
  const t = useT()
  const [program, setProgram] = useState<string | null>(null)
  const [args, setArgs] = useState(server.launch?.args.join(' ') ?? '-port {port:game}')
  const [error, setError] = useState<string | null>(null)
  const [shared, setShared] = useState(false)
  const installed = server.status !== 'not-installed' && server.status !== 'installing'
  const [runsBefore, runsAfter] = t('launch.runs').split('{program}')
  if (!installed || (!server.needsLaunchSetup && !server.launch)) return null

  async function save() {
    if (!program) return
    try {
      await window.neledport.setLaunch(server.id, program, args)
      setError(null)
    } catch (e) {
      setError(cleanError(e))
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-accent-2/40 bg-accent-2/5 p-4">
      {server.needsLaunchSetup ? (
        <>
          <p className="text-sm text-slate-200">
            <b className="text-white">{t('launch.oneMore')}</b> {t('launch.choose')}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void window.neledport.pickProgram(server.id).then((p) => p && setProgram(p))}
              className="min-h-9 rounded-lg border border-white/10 bg-ink-900 px-3 text-sm text-slate-100 hover:bg-ink-800"
            >
              {t('launch.chooseButton')}
            </button>
            <span className="min-w-0 truncate font-mono text-xs text-slate-300">{program ?? t('launch.nothing')}</span>
          </div>
          <label className="flex flex-col gap-1.5 text-xs text-slate-300">
            {t('launch.argsLabel')}
            <input
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              className="min-h-9 rounded-lg border border-white/10 bg-ink-950 px-2.5 font-mono text-xs text-slate-100 focus:border-accent focus:outline-none"
            />
          </label>
          <button type="button" disabled={!program} onClick={() => void save()} className="min-h-9 self-start rounded-lg bg-accent px-4 text-sm font-semibold text-ink-950 disabled:opacity-50">
            {t('common.save')}
          </button>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-200">
            {runsBefore}
            <span className="font-mono text-xs">{server.launch?.executable}</span>
            {runsAfter}
          </p>
          <button
            type="button"
            onClick={() => void window.neledport.shareDefinition(server.id).then(() => setShared(true), (e) => setError(cleanError(e)))}
            className="min-h-9 rounded-lg border border-accent-2/50 px-3 text-sm text-accent-2 hover:bg-accent-2/10"
          >
            {shared ? t('launch.shared') : t('launch.share')}
          </button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    </div>
  )
}

function BuildLine({ server }: { server: ServerView }) {
  const t = useT()
  const [checking, setChecking] = useState(false)
  const b = server.build
  if (!b.installed) return null
  const status = b.error
    ? b.error
    : !b.latest
      ? t('build.notChecked')
      : b.updateAvailable
        ? t('build.available', { build: b.latest })
        : t('build.upToDate')
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/5 bg-ink-950 px-3 py-2.5 text-sm">
      <span>
        <span className="font-mono text-slate-200">{t('build.label', { build: b.installed })}</span>
        <span className={`ml-2 ${b.updateAvailable ? 'text-accent' : b.error ? 'text-amber-200' : 'text-slate-400'}`}>· {status}</span>
      </span>
      <button
        type="button"
        disabled={checking}
        onClick={() => {
          setChecking(true)
          void window.neledport.checkBuild(server.id).finally(() => setChecking(false))
        }}
        className="min-h-8 rounded-lg border border-white/10 px-3 text-xs text-slate-200 hover:bg-ink-800 disabled:opacity-60"
      >
        {checking ? t('build.checking') : t('build.check')}
      </button>
    </div>
  )
}
