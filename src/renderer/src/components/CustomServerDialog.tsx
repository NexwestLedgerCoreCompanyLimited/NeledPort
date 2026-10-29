import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { AppInfo, ServerView } from '../../../core/types'
import { useT } from '../i18n'
import { cleanError } from '../status'

interface Props {
  info: AppInfo | null
  onClose: () => void
  onCreated: (server: ServerView) => void
}

const input = 'min-h-11 rounded-[10px] border border-white/10 bg-ink-950 px-3 text-sm text-slate-100 focus:border-accent focus:outline-none'

export function CustomServerDialog({ info, onClose, onCreated }: Props) {
  const t = useT()
  const [index, setIndex] = useState<{ appId: number; name: string }[]>([])
  const [query, setQuery] = useState('')
  const [appId, setAppId] = useState('')
  const [gameName, setGameName] = useState('')
  const [port, setPort] = useState('27015')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.neledport.steamServers().then(setIndex)
  }, [])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    return index.filter((s) => s.name.toLowerCase().includes(q) || String(s.appId) === q).slice(0, 8)
  }, [index, query])

  function pick(s: { appId: number; name: string }) {
    setAppId(String(s.appId))
    setGameName(s.name.replace(/\s*dedicated server\s*$/i, '').trim() || s.name)
    setQuery('')
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const server = await window.neledport.createServer({
        gameId: 'custom',
        name: t('add.defaultName', { game: gameName }),
        custom: { appId: Number(appId), name: gameName },
        ports: { game: Number(port) },
        settings: {}
      })
      onCreated(server)
      if (info?.canHostServers) void window.neledport.serverAction('install', server.id).catch(() => {})
    } catch (err) {
      setError(cleanError(err))
      setBusy(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="custom-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="flex w-full max-w-xl flex-col gap-5 rounded-2xl border border-white/10 bg-ink-900 p-6 shadow-2xl">
        <div>
          <p className="font-mono text-xs tracking-[0.3em] text-accent-2 uppercase">{t('custom.eyebrow')}</p>
          <h2 id="custom-title" className="mt-1 text-2xl font-semibold text-white">{t('custom.title')}</h2>
          <p className="mt-1 text-sm text-slate-300">{t('custom.intro')}</p>
        </div>

        <div className="relative">
          <label className="flex flex-col gap-1.5 text-[13px] text-slate-300">
            {t('custom.search', { count: index.length })}
            <input className={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('custom.searchPlaceholder')} />
          </label>
          {matches.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-[10px] border border-white/10 bg-ink-800 shadow-xl">
              {matches.map((s) => (
                <li key={s.appId}>
                  <button type="button" onClick={() => pick(s)} className="flex w-full justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-ink-700">
                    <span className="truncate text-slate-100">{s.name}</span>
                    <span className="shrink-0 font-mono text-xs text-slate-400">{s.appId}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid grid-cols-[1fr_2fr] gap-3">
          <label className="flex flex-col gap-1.5 text-[13px] text-slate-300">
            {t('custom.appId')}
            <input className={`${input} font-mono`} inputMode="numeric" pattern="\d+" value={appId} onChange={(e) => setAppId(e.target.value)} required />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] text-slate-300">
            {t('custom.gameName')}
            <input className={input} value={gameName} onChange={(e) => setGameName(e.target.value)} required maxLength={80} />
          </label>
        </div>
        <label className="flex w-40 flex-col gap-1.5 text-[13px] text-slate-300">
          {t('custom.port')}
          <input className={`${input} font-mono`} type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} />
        </label>

        {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="min-h-11 rounded-[10px] border border-white/10 px-5 text-sm text-slate-200 hover:bg-ink-800">
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={busy} className="min-h-11 rounded-[10px] bg-accent px-6 text-sm font-semibold text-ink-950 hover:bg-cyan-300 disabled:opacity-60">
            {info?.canHostServers ? t('add.createInstall') : t('add.create')}
          </button>
        </div>
      </form>
    </div>
  )
}
