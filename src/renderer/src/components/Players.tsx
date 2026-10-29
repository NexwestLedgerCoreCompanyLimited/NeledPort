import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { BanEntry, PlayerInfo, ServerView } from '../../../core/types'
import { cleanError } from '../status'

const btn = 'min-h-8 rounded-lg border px-2.5 text-xs disabled:opacity-50'

function duration(seconds?: number): string {
  if (seconds === undefined) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h ? `${h} h ${m} min` : `${m} min`
}

export function Players({ server }: { server: ServerView }) {
  const running = server.status === 'running'
  const caps = server.admin
  const [players, setPlayers] = useState<PlayerInfo[] | null>(null)
  const [bans, setBans] = useState<BanEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [banId, setBanId] = useState('')

  const refresh = useCallback(async () => {
    try {
      setBans(await window.neledport.bans(server.id))
      if (running && caps.players) setPlayers(await window.neledport.players(server.id))
      setError(null)
    } catch (e) {
      setError(cleanError(e))
    }
  }, [server.id, running, caps.players])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 10_000)
    return () => clearInterval(timer)
  }, [refresh])

  async function run(fn: () => Promise<void>) {
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(cleanError(e))
    }
  }

  function ban(p: PlayerInfo) {
    if (!window.confirm(`Ban ${p.name}?`)) return
    void run(() => window.neledport.ban(server.id, { id: p.id, name: p.name }))
  }

  function banById(e: FormEvent) {
    e.preventDefault()
    const id = banId.trim()
    if (!id) return
    void run(async () => {
      await window.neledport.ban(server.id, { id, name: id })
      setBanId('')
    })
  }

  return (
    <div className="mt-5 grid gap-4 md:grid-cols-[3fr_2fr]">
      <section className="rounded-[14px] border border-white/5 bg-ink-900 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-white">Online now {players && <span className="font-normal text-slate-400">· {players.length}</span>}</h2>
          <button type="button" onClick={() => void refresh()} className={`${btn} border-white/10 text-slate-200 hover:bg-ink-800`}>
            Refresh
          </button>
        </div>
        {error && <p role="alert" className="mb-3 rounded-lg border border-amber-400/30 bg-amber-400/10 p-2.5 text-sm text-amber-200">{error}</p>}
        {!caps.players ? (
          <p className="text-sm text-slate-400">This game does not report its players yet.</p>
        ) : !running ? (
          <p className="text-sm text-slate-400">Start the server to see who is online.</p>
        ) : players && players.length === 0 ? (
          <p className="text-sm text-slate-400">Nobody is online.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  <th className="py-2 font-medium">Player</th>
                  <th className="font-medium">ID</th>
                  <th className="font-medium">Ping</th>
                  <th className="font-medium">Online</th>
                  <th className="text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(players ?? []).map((p) => (
                  <tr key={p.id} className="border-t border-white/5">
                    <td className="py-2 font-medium text-white">{p.name}</td>
                    <td className="font-mono text-xs text-slate-400">{p.id === p.name ? '—' : p.id}</td>
                    <td className="font-mono text-xs text-slate-300">{p.ping !== undefined ? `${p.ping} ms` : '—'}</td>
                    <td className="text-slate-300">{duration(p.seconds)}</td>
                    <td className="space-x-1 text-right whitespace-nowrap">
                      {caps.kick && (
                        <button type="button" onClick={() => void run(() => window.neledport.kick(server.id, p))} className={`${btn} border-white/10 text-slate-200 hover:bg-ink-800`}>
                          Kick
                        </button>
                      )}
                      {caps.ban && (
                        <button type="button" onClick={() => ban(p)} className={`${btn} border-red-400/50 text-red-300 hover:bg-red-500/10`}>
                          Ban
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-[14px] border border-white/5 bg-ink-900 p-5">
        <h2 className="font-semibold text-white">Ban list <span className="font-normal text-slate-400">· {bans.length}</span></h2>
        <p className="text-xs text-slate-400">
          Saved through the game's own ban system, so bans stay when NeledPort is closed.
          {caps.banOnNextJoin && ' This game applies a ban the next time the player joins.'}
        </p>
        {!caps.ban ? (
          <p className="text-sm text-slate-400">Banning is not available for this game yet.</p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {bans.map((b) => (
                <li key={b.id} className="flex items-center gap-3 rounded-[10px] border border-white/5 bg-ink-950 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-white">{b.name || b.id}</div>
                    {(b.name || b.reason) && (
                      <div className="truncate font-mono text-[11px] text-slate-400">
                        {b.name ? b.id : ''}
                        {b.name && b.reason ? ' · ' : ''}
                        {b.reason ?? ''}
                      </div>
                    )}
                  </div>
                  {caps.unban && (
                    <button type="button" onClick={() => void run(() => window.neledport.unban(server.id, b.id))} className={`${btn} border-white/10 text-slate-200 hover:bg-ink-800`}>
                      Unban
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <form onSubmit={banById} className="flex gap-2">
              <label className="flex min-w-0 flex-1">
                <span className="sr-only">Player ID to ban</span>
                <input
                  value={banId}
                  onChange={(e) => setBanId(e.target.value)}
                  placeholder="Ban by Steam ID"
                  className="min-h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-ink-950 px-2.5 font-mono text-xs text-slate-100 focus:border-accent focus:outline-none"
                />
              </label>
              <button type="submit" className={`${btn} border-red-400/50 text-red-300 hover:bg-red-500/10`}>
                Ban
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  )
}
