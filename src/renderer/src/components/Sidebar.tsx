import { useEffect, useState } from 'react'
import type { ServerView, UpdateState } from '../../../core/types'
import { languages, translate } from '../../../core/i18n'
import { version } from '../../../../package.json'
import logo from '../assets/logo.png'
import { setLanguage, useLanguage, useT } from '../i18n'
import { statusDot } from '../status'

const REPO_URL = 'https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort'

function UpdateCard({ servers }: { servers: ServerView[] }) {
  const t = useT()
  const [update, setUpdate] = useState<UpdateState>({ status: 'none' })
  useEffect(() => {
    void window.neledport.updateState().then(setUpdate)
    return window.neledport.onUpdateChanged(setUpdate)
  }, [])
  if (update.status === 'none') return null
  if (update.status === 'downloading')
    return <p className="px-2.5 text-xs text-slate-400">{t('update.downloading', { version: update.version, percent: update.percent })}</p>

  function restart() {
    const active = servers.some((s) => !['stopped', 'crashed', 'not-installed'].includes(s.status))
    if (active && !window.confirm(t('update.confirmRunning'))) return
    void window.neledport.installUpdate()
  }
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-accent/40 bg-accent/5 p-3">
      <p className="text-[13px] text-white">{t('update.ready', { version: update.version })}</p>
      <button type="button" onClick={restart} className="min-h-9 rounded-lg bg-accent text-sm font-semibold text-ink-950 hover:bg-cyan-300">
        {t('update.restart')}
      </button>
      <a href={`${REPO_URL}/releases/tag/v${update.version}`} target="_blank" rel="noreferrer" className="text-xs text-slate-400 hover:text-accent">
        {t('update.whatsNew')}
      </a>
    </div>
  )
}

interface Props {
  servers: ServerView[]
  selected: string | null
  onSelect: (id: string | null) => void
}

export function Sidebar({ servers, selected, onSelect }: Props) {
  const t = useT()
  const lang = useLanguage()
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
        {t('sidebar.addServer')}
      </button>

      <nav aria-label={t('sidebar.servers')} className="flex flex-1 flex-col gap-1 overflow-y-auto">
        <h2 className="px-2 pt-1 pb-2 text-[11px] font-semibold tracking-[0.18em] text-slate-400 uppercase">{t('sidebar.servers')}</h2>
        {servers.length === 0 && (
          <p className="rounded-lg border border-dashed border-white/10 px-4 py-6 text-center text-sm text-slate-400">
            {t('sidebar.empty')}
            <br />
            {t('sidebar.emptyHint')}
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
                {s.gameName} · {t(`status.${s.status}`)}
              </span>
            </span>
          </button>
        ))}
      </nav>

      <UpdateCard servers={servers} />

      <footer className="flex flex-col gap-1 border-t border-white/5 pt-3 text-[13px]">
        <button
          type="button"
          onClick={() => onSelect(null)}
          aria-current={selected === null ? 'page' : undefined}
          className={`min-h-10 rounded-[10px] px-2.5 text-left ${selected === null ? 'bg-ink-800 text-white' : 'text-slate-300 hover:bg-ink-800/60'}`}
        >
          {t('sidebar.catalog')}
        </button>
        <a href={REPO_URL} target="_blank" rel="noreferrer" className="rounded-[10px] px-2.5 py-2 text-slate-400 hover:text-accent">
          {t('sidebar.star')}
        </a>
        <label className="flex items-center justify-between gap-2 px-2.5 py-1 text-slate-400">
          {t('sidebar.language')}
          <select
            value={lang}
            onChange={(e) => setLanguage(e.target.value)}
            className="min-h-8 rounded-lg border border-white/10 bg-ink-950 px-2 text-[13px] text-slate-100 focus:border-accent focus:outline-none"
          >
            {languages.map((l) => (
              <option key={l} value={l}>
                {translate(l, 'language.name')}
              </option>
            ))}
          </select>
        </label>
      </footer>
    </aside>
  )
}
