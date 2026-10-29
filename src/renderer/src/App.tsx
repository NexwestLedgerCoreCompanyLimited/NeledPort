import { useEffect, useState } from 'react'
import type { AppInfo, CatalogResult, GameDefinition, ServerView } from '../../core/types'
import { AddServerDialog } from './components/AddServerDialog'
import { Catalog } from './components/Catalog'
import { ServerPage } from './components/ServerPage'
import { Sidebar } from './components/Sidebar'

export default function App() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [catalog, setCatalog] = useState<CatalogResult | null>(null)
  const [servers, setServers] = useState<ServerView[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [adding, setAdding] = useState<GameDefinition | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const reloadServers = () => void window.neledport.listServers().then(setServers)

  useEffect(() => {
    const api = window.neledport
    Promise.all([api.appInfo(), api.listGames(), api.listServers()]).then(([i, c, s]) => {
      setInfo(i)
      setCatalog(c)
      setServers(s)
    }, (e: Error) => setLoadError(e.message))
    return api.onServerChanged((view) =>
      setServers((list) => (list.some((s) => s.id === view.id) ? list.map((s) => (s.id === view.id ? view : s)) : [...list, view]))
    )
  }, [])

  const server = servers.find((s) => s.id === selected)
  const notices = [
    loadError && `Could not load NeledPort data: ${loadError}`,
    info?.loadError,
    info && !info.canHostServers && 'Game servers run on Windows and Linux. On this computer you can explore the app, but not install or start servers.'
  ].filter(Boolean) as string[]

  return (
    <div className="flex h-full">
      <Sidebar servers={servers} selected={server ? server.id : null} onSelect={setSelected} />
      <main className="grid-bg flex-1 overflow-y-auto">
        {notices.map((n) => (
          <p key={n} role="alert" className="mx-10 mt-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            {n}
          </p>
        ))}
        {server ? (
          <ServerPage
            key={server.id}
            server={server}
            game={catalog?.games.find((g) => g.id === server.gameId)}
            info={info}
            onRemoved={() => {
              setSelected(null)
              reloadServers()
            }}
          />
        ) : (
          <Catalog info={info} catalog={catalog} servers={servers} onPick={setAdding} />
        )}
      </main>
      {adding && (
        <AddServerDialog
          game={adding}
          info={info}
          onClose={() => setAdding(null)}
          onCreated={(view) => {
            setAdding(null)
            setServers((list) => (list.some((s) => s.id === view.id) ? list : [...list, view]))
            setSelected(view.id)
          }}
        />
      )}
    </div>
  )
}
