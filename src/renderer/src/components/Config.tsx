import { useEffect, useState, type FormEvent } from 'react'
import type { GameDefinition, ServerView } from '../../../core/types'
import { useT } from '../i18n'
import { cleanError } from '../status'

const field = 'min-h-10 rounded-lg border border-white/10 bg-ink-950 px-3 text-sm text-slate-100 focus:border-accent focus:outline-none'

export function Config({ server, game, configFiles }: { server: ServerView; game: GameDefinition; configFiles: boolean }) {
  return (
    <div className="mt-5 flex flex-col gap-4">
      {!!game.settings?.length && <Settings server={server} game={game} />}
      {configFiles && <ConfigFiles server={server} adapter={!!game.configAdapter} />}
    </div>
  )
}

function Settings({ server, game }: { server: ServerView; game: GameDefinition }) {
  const t = useT()
  const fields = game.settings ?? []
  // Secrets are never sent to the UI: an empty box keeps the stored one.
  const fromView = (view: ServerView) => Object.fromEntries(fields.map((s) => [s.key, s.secret ? '' : (view.settings[s.key] ?? '')]))
  const [values, setValues] = useState(() => fromView(server))
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const running = server.status === 'running'

  async function save(restart: boolean) {
    setError(null)
    setSaved(false)
    try {
      setValues(fromView(await window.neledport.updateSettings(server.id, values)))
      setSaved(true)
      if (restart) await window.neledport.serverAction('restart', server.id)
    } catch (e) {
      setError(cleanError(e))
    }
  }

  return (
    <form
      onSubmit={(e: FormEvent) => (e.preventDefault(), void save(false))}
      className="flex flex-col gap-4 rounded-[14px] border border-white/5 bg-ink-900 p-5"
    >
      <div>
        <h2 className="font-semibold text-white">{t('config.settings')}</h2>
        <p className="mt-1 text-sm text-slate-400">{t('config.settingsHint')}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {fields.map((s) => (
          <label key={s.key} className="flex flex-col gap-1.5 text-[13px] text-slate-300">
            {s.label}
            <input
              className={field}
              type={s.type === 'password' ? 'password' : s.type === 'number' ? 'number' : 'text'}
              value={values[s.key] ?? ''}
              placeholder={s.secret ? t('config.keepSecret') : undefined}
              onChange={(e) => setValues({ ...values, [s.key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {saved && <span role="status" className="mr-auto text-sm text-emerald-400">{t('config.saved')}</span>}
        <button type="submit" className={`min-h-10 rounded-[10px] px-4 text-[13px] ${running ? 'border border-accent/50 text-accent hover:bg-accent/10' : 'bg-accent font-semibold text-ink-950 hover:bg-cyan-300'}`}>
          {t('common.save')}
        </button>
        {running && (
          <button type="button" onClick={() => void save(true)} className="min-h-10 rounded-[10px] bg-accent px-4 text-[13px] font-semibold text-ink-950 hover:bg-cyan-300">
            {t('config.saveRestart')}
          </button>
        )}
      </div>
    </form>
  )
}

function ConfigFiles({ server, adapter }: { server: ServerView; adapter: boolean }) {
  const t = useT()
  const [files, setFiles] = useState<{ path: string; text: string }[]>([])
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const stopped = server.status === 'stopped' || server.status === 'crashed' || server.status === 'not-installed'

  // Re-read after a run: the game or NeledPort may have changed the file.
  useEffect(() => {
    void window.neledport.configFiles(server.id).then(setFiles)
  }, [server.id, stopped])

  async function save(path: string) {
    setError(null)
    setSaved(null)
    try {
      await window.neledport.saveConfigFile(server.id, path, edits[path])
      setFiles(await window.neledport.configFiles(server.id))
      setEdits(({ [path]: _, ...rest }) => rest)
      setSaved(path)
    } catch (e) {
      setError(cleanError(e))
    }
  }

  return (
    <>
      {files.map((f) => {
        const text = edits[f.path] ?? f.text
        const changed = f.path in edits && edits[f.path] !== f.text
        return (
          <section key={f.path} className="flex flex-col gap-3 rounded-[14px] border border-white/5 bg-ink-900 p-5">
            <label className="flex flex-col gap-2">
              <span className="font-mono text-xs text-slate-300">{f.path}</span>
              <span className="text-sm text-slate-400">
                {t('config.fileHint')} {adapter && t('config.adapterNote')}
              </span>
              <textarea
                value={text}
                rows={16}
                spellCheck={false}
                readOnly={!stopped}
                onChange={(e) => setEdits({ ...edits, [f.path]: e.target.value })}
                className="rounded-[10px] border border-white/10 bg-[#05070c] px-4 py-3 font-mono text-[12.5px] leading-relaxed text-slate-200 focus:border-accent focus:outline-none read-only:opacity-70"
              />
            </label>
            {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {!stopped && <span className="mr-auto text-sm text-slate-400">{t('config.stopFirst')}</span>}
              {saved === f.path && !changed && <span role="status" className="mr-auto text-sm text-emerald-400">{t('config.saved')}</span>}
              <button
                type="button"
                disabled={!changed}
                onClick={() => setEdits(({ [f.path]: _, ...rest }) => rest)}
                className="min-h-10 rounded-[10px] border border-white/10 px-4 text-[13px] text-slate-100 hover:bg-ink-800 disabled:opacity-50"
              >
                {t('config.discard')}
              </button>
              <button
                type="button"
                disabled={!changed || !stopped}
                onClick={() => void save(f.path)}
                className="min-h-10 rounded-[10px] bg-accent px-4 text-[13px] font-semibold text-ink-950 hover:bg-cyan-300 disabled:opacity-50"
              >
                {t('common.save')}
              </button>
            </div>
          </section>
        )
      })}
    </>
  )
}
