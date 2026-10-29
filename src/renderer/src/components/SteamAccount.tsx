import { useEffect, useState } from 'react'
import { useT } from '../i18n'
import { cleanError } from '../status'

const btn = 'min-h-9 rounded-lg border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50'

/** Steam account for games that need one. The password goes into SteamCMD's own window, never through NeledPort. */
export function SteamAccount({ game, onAccount }: { game: string; onAccount?: (user: string | null) => void }) {
  const t = useT()
  const [account, setAccount] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [opened, setOpened] = useState(false)
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const use = (user: string | null) => {
    setAccount(user)
    onAccount?.(user)
  }

  useEffect(() => {
    void window.neledport.steamAccount().then(use)
  }, [])

  async function run(fn: () => Promise<void>) {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(cleanError(e))
    }
  }

  // Not a <form>: this sits inside the add-server form.
  function signIn(user: string) {
    void run(async () => {
      await window.neledport.steamSignIn(user)
      use(user)
      setOpened(true)
      setSignedIn(null)
    })
  }

  function check() {
    setChecking(true)
    void run(async () => setSignedIn(await window.neledport.steamCheck())).finally(() => setChecking(false))
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-accent-2/40 bg-accent-2/5 p-4">
      <h3 className="text-sm font-semibold text-white">{t('steam.title')}</h3>
      <p className="text-xs text-slate-300">{t('steam.why', { game })}</p>
      {account ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-sm ${signedIn === false ? 'text-amber-200' : signedIn ? 'text-emerald-400' : 'text-slate-200'}`}>
            {signedIn === null ? t('steam.account', { user: account }) : signedIn ? t('steam.ok', { user: account }) : t('steam.notOk', { user: account })}
          </span>
          <span className="flex-1" />
          <button type="button" disabled={checking} onClick={check} className={`${btn} border-white/10 text-slate-200 hover:bg-ink-800`}>
            {checking ? t('steam.checking') : t('steam.check')}
          </button>
          <button type="button" onClick={() => signIn(account)} className={`${btn} border-accent-2/50 text-accent-2 hover:bg-accent-2/10`}>
            {t('steam.signInAgain')}
          </button>
          <button
            type="button"
            onClick={() => void run(async () => (await window.neledport.steamSignOut(), use(null), setOpened(false), setSignedIn(null)))}
            className="min-h-9 rounded-lg px-2 text-xs text-slate-400 hover:text-red-300"
          >
            {t('steam.forget')}
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <label className="flex min-w-0 flex-1">
            <span className="sr-only">{t('steam.user')}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), signIn(name.trim()))}
              placeholder={t('steam.user')}
              autoComplete="username"
              className="min-h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-ink-950 px-2.5 text-sm text-slate-100 focus:border-accent focus:outline-none"
            />
          </label>
          <button type="button" onClick={() => signIn(name.trim())} className={`${btn} border-transparent bg-accent-2 font-semibold text-ink-950 hover:opacity-90`}>
            {t('steam.signIn')}
          </button>
        </div>
      )}
      {opened && <p className="text-xs text-slate-300">{t('steam.opened')}</p>}
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
    </section>
  )
}
