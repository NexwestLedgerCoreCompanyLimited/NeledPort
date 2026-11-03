import { InMemoryTransport } from '@modelcontextprotocol/server'
import { describe, expect, it, vi } from 'vitest'
import { createMcpServer } from './mcp'

type Message = { id?: number; result?: any; error?: any }

/** Talks raw MCP JSON-RPC to the server, the way a client such as Claude Desktop does. */
async function client(o: { allowCreate?: boolean; call?: (method: string, params: unknown) => Promise<unknown> } = {}) {
  const call = vi.fn(o.call ?? (async (method: string) => (method === 'servers.list' ? [{ id: 'ab12cd34', name: 'Valheim', status: 'running' }] : null)))
  const server = createMcpServer({ call, allowCreate: o.allowCreate, version: '0.9.0' })
  const [mine, theirs] = InMemoryTransport.createLinkedPair()
  const replies = new Map<number, (m: Message) => void>()
  mine.onmessage = (m) => replies.get(Number((m as Message).id))?.(m as Message)
  await server.connect(theirs)
  await mine.start()
  let next = 1
  const request = (method: string, params: unknown = {}) =>
    new Promise<Message>((resolve) => {
      const id = next++
      replies.set(id, resolve)
      void mine.send({ jsonrpc: '2.0', id, method, params } as never)
    })
  const init = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
  await mine.send({ jsonrpc: '2.0', method: 'notifications/initialized' } as never)
  return { request, call, init }
}

describe('MCP server', () => {
  it('introduces itself as NeledPort to a 2025-06-18 client', async () => {
    const { init } = await client()
    expect(init.result.serverInfo).toMatchObject({ name: 'neledport', version: '0.9.0' })
    expect(init.result.protocolVersion).toBe('2025-06-18')
    expect(init.result.capabilities.tools).toBeDefined()
  })

  it('lists the tools an AI needs, marking which ones only read', async () => {
    const { request } = await client()
    const { result } = await request('tools/list')
    const names = result.tools.map((t: { name: string }) => t.name)
    expect(names).toEqual(
      expect.arrayContaining(['machine_status', 'list_servers', 'start_server', 'stop_server', 'run_command', 'ban_player', 'console_output'])
    )
    expect(names).not.toContain('create_server')
    const tool = (name: string) => result.tools.find((t: { name: string }) => t.name === name)
    expect(tool('list_servers').annotations).toMatchObject({ readOnlyHint: true })
    expect(tool('stop_server').annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true })
  })

  it('offers creating and installing servers only when allowed', async () => {
    const { request } = await client({ allowCreate: true })
    const names = (await request('tools/list')).result.tools.map((t: { name: string }) => t.name)
    expect(names).toEqual(expect.arrayContaining(['create_server', 'install_server']))
  })

  it('runs a tool through the NeledPort API and returns its answer', async () => {
    const { request, call } = await client()
    const { result } = await request('tools/call', { name: 'list_servers', arguments: {} })
    expect(call).toHaveBeenCalledWith('servers.list', {})
    expect(JSON.parse(result.content[0].text)).toEqual([{ id: 'ab12cd34', name: 'Valheim', status: 'running' }])
    await request('tools/call', { name: 'ban_player', arguments: { server_id: 'ab12cd34', player_id: '7656', player_name: 'Mira', reason: 'griefing' } })
    expect(call).toHaveBeenLastCalledWith('servers.ban', { id: 'ab12cd34', player: { id: '7656', name: 'Mira' }, reason: 'griefing' })
  })

  it('shows the AI an error instead of crashing when NeledPort refuses', async () => {
    const { request } = await client({
      call: async () => {
        throw new Error('servers.stop is not allowed for a view device')
      }
    })
    const { result } = await request('tools/call', { name: 'stop_server', arguments: { server_id: 'ab12cd34' } })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/not allowed/)
  })

  it('reports an unreachable NeledPort when searching games, instead of an empty list', async () => {
    const { request } = await client({
      call: async () => {
        throw new Error('NeledPort is not running on this machine')
      }
    })
    const { result } = await request('tools/call', { name: 'list_games', arguments: { search: 'val' } })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/not running/)
  })

  it('rejects arguments that do not fit before calling NeledPort', async () => {
    const { request, call } = await client()
    const reply = await request('tools/call', { name: 'start_server', arguments: { server_id: 42 } })
    expect(reply.error ?? reply.result?.isError).toBeTruthy()
    expect(call).not.toHaveBeenCalled()
  })
})
