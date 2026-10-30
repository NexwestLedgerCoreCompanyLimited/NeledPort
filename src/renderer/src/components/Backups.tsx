import { useEffect, useState } from 'react'
import { KEEP_BACKUPS, type BackupInfo, type GameDefinition, type ServerView } from '../../../core/types'
import { useLanguage, useT } from '../i18n'
import { cleanError } from '../status'

export function Backups({ server, game }: { server: ServerView; game?: GameDefinition }) {
  const t = useT()
  const lang = useLanguage()
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [restoring, setRestoring] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const stopped = server.status === 'stopped' || server.status === 'crashed'

  useEffect(() => {
    void window.neledport.serverBackups(server.id).then(setBackups)
  }, [server.id, server.status, done])

  async function restore(b: BackupInfo) {
    const date = new Date(b.createdAt).toLocaleString(lang)
    if (!window.confirm(t('backups.restoreConfirm', { date }))) return
    setError(null)
    setDone(null)
    setRestoring(b.file)
    try {
      await window.neledport.restoreBackup(server.id, b.file)
      setDone(t('backups.restored', { date }))
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setRestoring(null)
    }
  }

  async function backupNow() {
    setError(null)
    try {
      await window.neledport.serverAction('backup', server.id)
      setBackups(await window.neledport.serverBackups(server.id))
    } catch (e) {
      setError(cleanError(e))
    }
  }

  if (!game?.saveDir) return <p className="mt-5 text-sm text-slate-300">{t('backups.noSaveDir', { game: server.gameName })}</p>

  return (
    <section className="mt-5 flex flex-col gap-4 rounded-[14px] border border-white/5 bg-ink-900 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-300">{t('backups.intro', { count: KEEP_BACKUPS })}</p>
        <button type="button" onClick={() => void backupNow()} className="min-h-10 rounded-[10px] bg-accent px-4 text-[13px] font-semibold text-ink-950 hover:bg-cyan-300">
          {t('action.backup')}
        </button>
      </div>
      {done && <p role="status" className="text-sm text-emerald-400">{done}</p>}
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {backups.length === 0 ? (
        <p className="text-sm text-slate-400">{t('overview.noBackups')}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 text-left text-xs text-slate-400">
              <th className="py-2 font-medium">{t('backups.made')}</th>
              <th className="py-2 font-medium">{t('backups.reason')}</th>
              <th className="py-2 font-medium">{t('backups.size')}</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {backups.map((b) => (
              <tr key={b.file} className="border-b border-white/5 last:border-0">
                <td className="py-2 text-white">{new Date(b.createdAt).toLocaleString(lang)}</td>
                <td className="text-slate-300">{t(`backup.${b.reason}`)}</td>
                <td className="font-mono text-xs text-slate-300">{(b.size / 1024 / 1024).toFixed(1)} MB</td>
                <td className="py-1.5 text-right">
                  <button
                    type="button"
                    disabled={!stopped || !!restoring}
                    title={stopped ? undefined : t('backups.stopFirst')}
                    onClick={() => void restore(b)}
                    className="min-h-9 rounded-lg border border-white/10 px-3 text-xs text-slate-100 hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {restoring === b.file ? t('backups.restoring') : t('backups.restore')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!stopped && backups.length > 0 && <p className="text-xs text-slate-400">{t('backups.stopFirst')}</p>}
    </section>
  )
}
