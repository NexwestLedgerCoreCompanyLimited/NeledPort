export type Ns2State = { player_list?: { name: string; steamid: number; ping?: number; isbot?: boolean }[] }

/**
 * Natural Selection 2's built-in web admin (-webadmin), as NS2AdminLib uses it: HTTP basic auth as "admin";
 * GET /?request=json is the server state with its player list, and &command=Send&rcon=<command> runs a console command.
 */
export function ns2WebAdmin(o: { port: number; password: string }) {
  const auth = 'Basic ' + Buffer.from(`admin:${o.password}`).toString('base64')
  const get = async (query: string): Promise<string> => {
    let res: Response
    try {
      res = await fetch(`http://127.0.0.1:${o.port}/?${query}`, { headers: { Authorization: auth }, signal: AbortSignal.timeout(5000) })
    } catch (e) {
      throw new Error(`The NS2 web admin is not reachable (${(e as Error).message}); is the server running?`)
    }
    if (!res.ok) throw new Error(`The NS2 web admin answered HTTP ${res.status}`)
    return res.text()
  }
  return {
    state: async (): Promise<Ns2State> => JSON.parse(await get('request=json')) as Ns2State,
    send: async (command: string): Promise<void> => void (await get(`request=json&command=Send&rcon=${encodeURIComponent(command)}`))
  }
}
