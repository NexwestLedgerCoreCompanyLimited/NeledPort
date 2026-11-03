import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { AuditEntry, Device, MachineInfo, RemoteStatus, ServerStatus } from '../../../core/types'
import { useT } from '../i18n'
import { cleanError, statusDot } from '../status'

const card = 'flex flex-col gap-4 rounded-[14px] border border-white/5 bg-ink-900 p-5'
const input = 'min-h-9 rounded-lg border border-white/10 bg-ink-950 px-2.5 text-[13px] text-slate-100 focus:border-accent focus:outline-none'
const btn = 'min-h-9 rounded-lg border border-white/10 px-3 text-[13px] text-slate-200 hover:border-accent hover:text-accent disabled:opacity-50'
const primary = 'min-h-9 rounded-lg bg-accent px-3 text-[13px] font-semibold text-ink-950 hover:bg-cyan-300 disabled:opacity-50'
const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`

function Alert({ text }: { text: string | null }) {
  return text ? (
    <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
      {text}
    </p>
  ) : null
}

interface MachineStatus {
  hostname: string
  platform: string
  cpu: { cores: number; percent: number }
  memory: { total: number; free: number }
  disk: { total: number; free: number }
}
interface RemoteServer {
  id: string
  name: string
  gameName: string
  status: ServerStatus
  players?: number
}

function MachineCard({ machine, onRemove }: { machine: MachineInfo; onRemove: () => void }) {
  const t = useT()
  const [status, setStatus] = useState<MachineStatus | null>(null)
  const [servers, setServers] = useState<RemoteServer[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const call = (method: string, params?: Record<string, unknown>) => window.neledport.machineCall(machine.id, method, params)

  const refresh = useCallback(async () => {
    try {
      const [s, list] = await Promise.all([call('machine.status'), call('servers.list')])
      setStatus(s as MachineStatus)
      setServers(list as RemoteServer[])
      setError(null)
    } catch (e) {
      setError(cleanError(e))
    }
  }, [machine.id])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 10_000)
    return () => clearInterval(timer)
  }, [refresh])

  async function act(s: RemoteServer, action: 'start' | 'stop' | 'restart' | 'backup') {
    if ((action === 'stop' || action === 'restart') && !window.confirm(t(`remote.confirm.${action}`, { name: s.name, machine: machine.name }))) return
    setBusy(s.id)
    try {
      await call(`servers.${action}`, { id: s.id })
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setBusy(null)
      void refresh()
    }
  }

  return (
    <section className={card} aria-label={machine.name}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-white">{machine.name}</h3>
          <p className="font-mono text-xs text-slate-400">
            {machine.address} · {t(`remote.role.${machine.role}`)}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className={btn} onClick={() => void refresh()}>
            {t('common.refresh')}
          </button>
          <button type="button" className={btn} onClick={() => window.confirm(t('remote.confirm.forget', { machine: machine.name })) && onRemove()}>
            {t('remote.forget')}
          </button>
        </div>
      </header>
      <Alert text={error} />
      {status && (
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div className="rounded-lg bg-ink-950/60 p-3">
            <dt className="text-xs text-slate-400">CPU</dt>
            <dd className="font-mono text-white">{t('remote.cpu', { percent: status.cpu.percent, cores: status.cpu.cores })}</dd>
          </div>
          <div className="rounded-lg bg-ink-950/60 p-3">
            <dt className="text-xs text-slate-400">{t('remote.memory')}</dt>
            <dd className="font-mono text-white">
              {gb(status.memory.total - status.memory.free)} / {gb(status.memory.total)}
            </dd>
          </div>
          <div className="rounded-lg bg-ink-950/60 p-3">
            <dt className="text-xs text-slate-400">{t('remote.disk')}</dt>
            <dd className="font-mono text-white">{t('remote.diskFree', { free: gb(status.disk.free), total: gb(status.disk.total) })}</dd>
          </div>
        </dl>
      )}
      {status && servers.length === 0 && <p className="text-sm text-slate-400">{t('remote.noServers')}</p>}
      <ul className="flex flex-col">
        {servers.map((s) => {
          const running = s.status === 'running'
          const canStart = s.status === 'stopped' || s.status === 'crashed'
          return (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 py-2.5 last:border-0">
              <span className="flex min-w-0 items-center gap-2.5">
                <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${statusDot[s.status]}`} />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-white">{s.name}</span>
                  <span className="text-xs text-slate-400">
                    {s.gameName} · {t(`status.${s.status}`)}
                    {s.players !== undefined && ` · ${t('remote.players', { count: s.players })}`}
                  </span>
                </span>
              </span>
              {machine.role === 'control' && (
                <span className="flex gap-2">
                  {canStart && (
                    <button type="button" className={btn} disabled={busy === s.id} onClick={() => void act(s, 'start')}>
                      {t('remote.start')}
                    </button>
                  )}
                  {running && (
                    <>
                      <button type="button" className={btn} disabled={busy === s.id} onClick={() => void act(s, 'restart')}>
                        {t('remote.restart')}
                      </button>
                      <button type="button" className={btn} disabled={busy === s.id} onClick={() => void act(s, 'stop')}>
                        {t('remote.stop')}
                      </button>
                    </>
                  )}
                  <button type="button" className={btn} disabled={busy === s.id} onClick={() => void act(s, 'backup')}>
                    {t('remote.backup')}
                  </button>
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function OtherMachines() {
  const t = useT()
  const [machines, setMachines] = useState<MachineInfo[]>([])
  const [form, setForm] = useState({ name: '', address: '', code: '' })
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => void window.neledport.machines().then(setMachines), [])

  async function add(e: FormEvent) {
    e.preventDefault()
    setAdding(true)
    try {
      const m = await window.neledport.addMachine(form.name, form.address, form.code)
      setMachines((list) => [...list, m])
      setForm({ name: '', address: '', code: '' })
      setError(null)
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setAdding(false)
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-white">{t('remote.otherMachines')}</h2>
      {machines.map((m) => (
        <MachineCard
          key={m.id}
          machine={m}
          onRemove={() => void window.neledport.removeMachine(m.id).then(() => setMachines((list) => list.filter((x) => x.id !== m.id)))}
        />
      ))}
      <form onSubmit={add} className={card}>
        <h3 className="font-semibold text-white">{t('remote.addMachine')}</h3>
        <p className="text-sm text-slate-400">{t('remote.addMachineHint')}</p>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_2fr]">
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            {t('remote.machineName')}
            <input className={input} value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            {t('remote.address')}
            <input className={input} required placeholder="203.0.113.5:47800" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            {t('remote.code')}
            <input
              className={`${input} font-mono`}
              required
              type="password"
              autoComplete="off"
              placeholder="np1.…"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
            />
          </label>
        </div>
        <Alert text={error} />
        <div>
          <button type="submit" className={primary} disabled={adding}>
            {adding ? t('remote.connecting') : t('remote.connect')}
          </button>
        </div>
      </form>
    </section>
  )
}

function ThisComputer() {
  const t = useT()
  const [state, setState] = useState<{ status: RemoteStatus; devices: Device[]; activity: AuditEntry[] } | null>(null)
  const [settings, setSettings] = useState({ enabled: false, port: '47800', host: '0.0.0.0' })
  const [device, setDevice] = useState({ name: '', role: 'control' as Device['role'] })
  const [code, setCode] = useState<{ name: string; code: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setState(await window.neledport.remoteLocal())
    } catch (e) {
      setError(cleanError(e))
    }
  }, [])
  useEffect(() => {
    void window.neledport.remoteLocal().then((s) => {
      setState(s)
      setSettings({ enabled: s.status.enabled, port: String(s.status.port), host: s.status.host })
    }, (e) => setError(cleanError(e)))
    const timer = setInterval(() => void refresh(), 15_000)
    return () => clearInterval(timer)
  }, [refresh])

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn()
      setError(null)
    } catch (e) {
      setError(cleanError(e))
    }
    await refresh()
  }
  const apply = (e: FormEvent) => {
    e.preventDefault()
    void run(() => window.neledport.setRemote({ enabled: settings.enabled, port: Number(settings.port), host: settings.host.trim() }))
  }
  const addDevice = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      const r = await window.neledport.addDevice(device.name, device.role)
      setCode({ name: r.device.name, code: r.code })
      setDevice({ ...device, name: '' })
    })
  }

  const s = state?.status
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-white">{t('remote.thisComputer')}</h2>
      <Alert text={error} />
      <form onSubmit={apply} className={card}>
        <h3 className="font-semibold text-white">{t('remote.access')}</h3>
        <p className="text-sm text-slate-400">{t('remote.accessHint')}</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-h-9 items-center gap-2 text-sm text-slate-200">
            <input type="checkbox" checked={settings.enabled} onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })} />
            {t('remote.allow')}
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            {t('remote.port')}
            <input className={`${input} w-28`} inputMode="numeric" value={settings.port} onChange={(e) => setSettings({ ...settings, port: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            {t('remote.listenOn')}
            <input className={`${input} w-40`} value={settings.host} onChange={(e) => setSettings({ ...settings, host: e.target.value })} />
          </label>
          <button type="submit" className={primary}>
            {t('common.save')}
          </button>
        </div>
        {s && (
          <p className={`text-sm ${s.error ? 'text-red-300' : s.listening ? 'text-emerald-300' : 'text-slate-400'}`}>
            {s.error
              ? t('remote.failed', { error: s.error })
              : s.listening
                ? t('remote.listening', { host: s.host, port: s.listening })
                : t('remote.off')}
          </p>
        )}
        {s?.listening !== undefined && <p className="text-xs text-amber-200">{t('remote.firewall', { port: s.listening })}</p>}
      </form>

      <div className={card}>
        <h3 className="font-semibold text-white">{t('remote.devices')}</h3>
        {state?.devices.length === 0 && <p className="text-sm text-slate-400">{t('remote.noDevices')}</p>}
        <ul className="flex flex-col">
          {state?.devices.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 py-2 text-sm last:border-0">
              <span>
                <span className="text-white">{d.name}</span> <span className="text-slate-400">· {t(`remote.role.${d.role}`)}</span>
                <span className="block font-mono text-xs text-slate-400">
                  {d.lastSeen ? t('remote.lastSeen', { time: new Date(d.lastSeen).toLocaleString(), address: d.lastAddress ?? '' }) : t('remote.neverSeen')}
                </span>
              </span>
              <button
                type="button"
                className={btn}
                onClick={() => window.confirm(t('remote.confirm.revoke', { name: d.name })) && void run(() => window.neledport.revokeDevice(d.id))}
              >
                {t('remote.revoke')}
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={addDevice} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            {t('remote.deviceName')}
            <input className={input} required maxLength={40} value={device.name} onChange={(e) => setDevice({ ...device, name: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            {t('remote.deviceRole')}
            <select className={input} value={device.role} onChange={(e) => setDevice({ ...device, role: e.target.value as Device['role'] })}>
              <option value="view">{t('remote.role.view')}</option>
              <option value="control">{t('remote.role.control')}</option>
            </select>
          </label>
          <button type="submit" className={primary}>
            {t('remote.pair')}
          </button>
        </form>
        {code && (
          <div className="flex flex-col gap-2 rounded-lg border border-accent/40 bg-accent/5 p-3">
            <p className="text-sm text-white">{t('remote.codeFor', { name: code.name })}</p>
            <code className="font-mono text-[13px] break-all text-accent select-all">{code.code}</code>
            <p className="text-xs text-slate-400">{t('remote.codeOnce')}</p>
            <div className="flex gap-2">
              <button type="button" className={btn} onClick={() => void navigator.clipboard.writeText(code.code)}>
                {t('remote.copy')}
              </button>
              <button type="button" className={btn} onClick={() => setCode(null)}>
                {t('remote.done')}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className={card}>
        <h3 className="font-semibold text-white">{t('remote.activity')}</h3>
        {state?.activity.length === 0 && <p className="text-sm text-slate-400">{t('remote.noActivity')}</p>}
        <ul className="flex max-h-72 flex-col overflow-y-auto font-mono text-xs">
          {state?.activity.slice(0, 50).map((a, i) => (
            <li key={`${a.time}-${i}`} className={`border-b border-white/5 py-1.5 last:border-0 ${a.ok ? 'text-slate-300' : 'text-red-300'}`}>
              {new Date(a.time).toLocaleString()} · {a.device}
              {a.address && ` (${a.address})`} · {a.method}
              {a.server && ` ${a.server}`} · {a.ok ? 'ok' : a.error}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export function Remote() {
  const t = useT()
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-10 py-7">
      <header>
        <h1 className="text-2xl font-semibold text-white">{t('remote.title')}</h1>
        <p className="mt-1 text-sm text-slate-400">{t('remote.intro')}</p>
      </header>
      <OtherMachines />
      <ThisComputer />
    </div>
  )
}
