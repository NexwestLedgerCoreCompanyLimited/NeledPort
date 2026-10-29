import { useState, type FormEvent } from 'react'
import type { AppInfo, GameDefinition, ServerView } from '../../../core/types'
import { useT } from '../i18n'
import { cleanError } from '../status'

interface Props {
  game: GameDefinition
  info: AppInfo | null
  onClose: () => void
  onCreated: (server: ServerView) => void
}

const input =
  'min-h-11 rounded-[10px] border border-white/10 bg-ink-950 px-3 text-sm text-slate-100 focus:border-accent focus:outline-none'

export function AddServerDialog({ game, info, onClose, onCreated }: Props) {
  const t = useT()
  const usesNameSetting = game.settings?.some((s) => s.key === 'serverName')
  const [name, setName] = useState(t('add.defaultName', { game: game.name }))
  const [settings, setSettings] = useState<Record<string, string>>(() =>
    Object.fromEntries((game.settings ?? []).filter((s) => s.key !== 'serverName').map((s) => [s.key, s.default !== undefined ? String(s.default) : '']))
  )
  const [ports, setPorts] = useState<Record<string, string>>(() => Object.fromEntries(game.ports.map((p) => [p.name, String(p.default)])))
  const [installDir, setInstallDir] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const server = await window.neledport.createServer({
        gameId: game.id,
        name,
        settings: usesNameSetting ? { ...settings, serverName: name } : settings,
        ports: Object.fromEntries(Object.entries(ports).map(([k, v]) => [k, Number(v)])),
        installDir: installDir.trim() || undefined
      })
      onCreated(server)
      if (info?.canHostServers) void window.neledport.serverAction('install', server.id).catch(() => {})
    } catch (err) {
      setError(cleanError(err))
      setBusy(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="add-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-xl flex-col gap-5 overflow-y-auto rounded-2xl border border-white/10 bg-ink-900 p-6 shadow-2xl"
      >
        <div>
          <p className="font-mono text-xs tracking-[0.3em] text-accent uppercase">{t('add.eyebrow')}</p>
          <h2 id="add-title" className="mt-1 text-2xl font-semibold text-white">
            {game.name}
          </h2>
          <p className="mt-1 text-sm text-slate-300">{t('add.intro')}</p>
        </div>

        <label className="flex flex-col gap-1.5 text-[13px] text-slate-300">
          {t('add.name')}
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} required maxLength={64} autoFocus />
        </label>

        {(game.settings ?? [])
          .filter((s) => s.key !== 'serverName')
          .map((s) => (
            <label key={s.key} className="flex flex-col gap-1.5 text-[13px] text-slate-300">
              {s.label}
              <input
                className={input}
                type={s.type === 'password' ? 'password' : s.type === 'number' ? 'number' : 'text'}
                value={settings[s.key] ?? ''}
                minLength={s.minLength}
                required={!!s.minLength}
                onChange={(e) => setSettings({ ...settings, [s.key]: e.target.value })}
              />
            </label>
          ))}

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[11px] font-semibold tracking-[0.12em] text-slate-400 uppercase">{t('add.ports')}</legend>
          <div className="grid grid-cols-3 gap-3">
            {game.ports.map((p) => (
              <label key={p.name} className="flex flex-col gap-1.5 text-xs text-slate-300 capitalize">
                {p.name} · {p.protocol.toUpperCase()}
                <input
                  className={`${input} font-mono`}
                  type="number"
                  min={1}
                  max={65535}
                  value={ports[p.name]}
                  onChange={(e) => setPorts({ ...ports, [p.name]: e.target.value })}
                />
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex flex-col gap-1.5 text-[13px] text-slate-300">
          {t('add.installDir')}
          <input
            className={`${input} font-mono text-[13px]`}
            value={installDir}
            onChange={(e) => setInstallDir(e.target.value)}
            placeholder={`${info?.serversDir ?? ''}/${game.id}-…`}
          />
        </label>

        {error && (
          <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </p>
        )}

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
