import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { LoaderInfo, PluginInfo, ServerView } from '../../../core/types'
import { cleanError } from '../status'

const btn = 'min-h-9 rounded-lg border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50'

function LoaderCard({ server, loader, onError }: { server: ServerView; loader: LoaderInfo; onError: (e: string | null) => void }) {
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [busy, setBusy] = useState(false)
  const running = server.status !== 'stopped' && server.status !== 'crashed'

  const refresh = useCallback(async () => {
    if (loader.installed) setPlugins(await window.neledport.plugins(server.id, loader.id))
  }, [server.id, loader.id, loader.installed])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    onError(null)
    try {
      await fn()
      await refresh()
    } catch (e) {
      onError(cleanError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-[14px] border border-white/5 bg-ink-900 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-white">{loader.name}</h2>
          <p className="text-xs text-slate-400">
            {loader.installed ? `Installed ${new Date(loader.installedAt!).toLocaleString()}` : 'Runs on the server only; players install nothing.'}
          </p>
        </div>
        <button
          type="button"
          disabled={busy || running}
          title={running ? 'Stop the server first' : undefined}
          onClick={() => {
            if (!loader.installed) return void run(() => window.neledport.installLoader(server.id, loader.id))
            if (window.confirm(`Remove ${loader.name}? Plugins stay in the folder.`)) void run(() => window.neledport.uninstallLoader(server.id, loader.id))
          }}
          className={`${btn} ${loader.installed ? 'border-white/10 text-slate-200 hover:bg-ink-800' : 'border-transparent bg-accent font-semibold text-ink-950 hover:bg-cyan-300'}`}
        >
          {busy ? 'Working…' : loader.installed ? 'Remove' : `Install ${loader.name}`}
        </button>
      </div>
      {running && <p className="text-xs text-amber-200">Stop the server to install or remove the loader. Plugins can change while it runs.</p>}

      {loader.installed && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold tracking-[0.1em] text-slate-400 uppercase">Plugins · {plugins.length}</h3>
            <button type="button" onClick={() => void run(() => window.neledport.addPlugin(server.id, loader.id))} className={`${btn} border-accent/50 text-accent hover:bg-accent/10`}>
              + Add plugin
            </button>
          </div>
          {plugins.length === 0 ? (
            <p className="text-sm text-slate-400">No plugins yet. Add a plugin file you downloaded.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {plugins.map((p) => (
                <li key={p.name} className="flex items-center gap-3 rounded-[10px] border border-white/5 bg-ink-950 px-3 py-2">
                  <span className={`min-w-0 flex-1 truncate text-sm ${p.enabled ? 'text-white' : 'text-slate-500 line-through'}`}>{p.name}</span>
                  <span className="font-mono text-[11px] text-slate-400">{(p.size / 1024).toFixed(1)} KB</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={p.enabled}
                    aria-label={`${p.enabled ? 'Disable' : 'Enable'} ${p.name}`}
                    onClick={() => void run(() => window.neledport.setPluginEnabled(server.id, loader.id, p.name, !p.enabled))}
                    className={`relative h-6 w-10 shrink-0 rounded-full ${p.enabled ? 'bg-accent' : 'bg-ink-700'}`}
                  >
                    <span aria-hidden="true" className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${p.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => window.confirm(`Delete ${p.name}?`) && void run(() => window.neledport.removePlugin(server.id, loader.id, p.name))}
                    className="min-h-8 rounded-lg px-2 text-xs text-slate-400 hover:text-red-300"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

function Workshop({ server, onError }: { server: ServerView; onError: (e: string | null) => void }) {
  const [item, setItem] = useState('')
  const [done, setDone] = useState<string | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault()
    // Accept a bare id or a Workshop URL (…/filedetails/?id=123).
    const id = /id=(\d+)/.exec(item)?.[1] ?? item.trim()
    onError(null)
    try {
      await window.neledport.workshop(server.id, id)
      setDone(id)
      setItem('')
    } catch (err) {
      onError(cleanError(err))
    }
  }
  return (
    <section className="flex flex-col gap-3 rounded-[14px] border border-white/5 bg-ink-900 p-5">
      <h2 className="font-semibold text-white">Steam Workshop</h2>
      <p className="text-sm text-slate-300">Paste a Workshop map link or id. The server downloads it and switches to it.</p>
      <form onSubmit={submit} className="flex gap-2">
        <label className="flex min-w-0 flex-1">
          <span className="sr-only">Workshop link or id</span>
          <input
            value={item}
            onChange={(e) => setItem(e.target.value)}
            placeholder="https://steamcommunity.com/sharedfiles/filedetails/?id=…"
            className="min-h-10 min-w-0 flex-1 rounded-lg border border-white/10 bg-ink-950 px-3 font-mono text-xs text-slate-100 focus:border-accent focus:outline-none"
          />
        </label>
        <button type="submit" disabled={server.status !== 'running'} className={`${btn} border-transparent bg-accent font-semibold text-ink-950 hover:bg-cyan-300`}>
          Load
        </button>
      </form>
      {server.status !== 'running' && <p className="text-xs text-slate-400">Start the server to load Workshop items.</p>}
      {done && <p className="text-xs text-emerald-400">Sent: loading Workshop item {done}. Watch the console for progress.</p>}
    </section>
  )
}

export function Mods({ server }: { server: ServerView }) {
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="mt-5 flex flex-col gap-4">
      {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      {server.loaders.map((l) => (
        <LoaderCard key={l.id} server={server} loader={l} onError={setError} />
      ))}
      {server.workshop && <Workshop server={server} onError={setError} />}
      {!server.loaders.length && !server.workshop && (
        <p className="rounded-[14px] border border-dashed border-white/10 p-6 text-center text-sm text-slate-400">
          No one-click mods for this game yet. Know how its mods work? Add a mod loader to its definition.
        </p>
      )}
    </div>
  )
}
