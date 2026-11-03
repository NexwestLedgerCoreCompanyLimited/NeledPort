import { McpServer, type CallToolResult } from '@modelcontextprotocol/server'
import * as z from 'zod'

/**
 * NeledPort as an MCP server: each tool is one call to the NeledPort API, so the AI gets exactly what a paired device
 * with the same role gets, and every action lands in the activity log.
 */
const serverId = z.string().regex(/^[0-9a-f]{8}$/).describe('The 8-character server id from list_servers')
const player = { player_id: z.string().max(200).describe('Steam ID or name, as list_players shows it'), player_name: z.string().max(200) }
const reason = z.string().max(200).optional()

const INSTRUCTIONS = `NeledPort hosts Steam dedicated game servers (Valheim, Palworld, Rust, ARK, CS2...) on this machine or a paired one.
Find a server's id with list_servers first. stop_server saves the world before it stops. Console commands are the game's own
(its RCON or console), so check the game's command names before using run_command.`

export function createMcpServer(o: { call: (method: string, params: unknown) => Promise<unknown>; allowCreate?: boolean; version: string }): McpServer {
  const server = new McpServer({ name: 'neledport', title: 'NeledPort', version: o.version }, { instructions: INSTRUCTIONS })
  const run = async (method: string, params: unknown): Promise<CallToolResult> => {
    try {
      const result = await o.call(method, params)
      return { content: [{ type: 'text', text: result === null || result === undefined ? 'Done.' : JSON.stringify(result, null, 2) }] }
    } catch (e) {
      return { content: [{ type: 'text', text: (e as Error).message }], isError: true }
    }
  }
  const read = { readOnlyHint: true, openWorldHint: false }
  const act = (destructiveHint: boolean) => ({ readOnlyHint: false, destructiveHint, openWorldHint: false })

  server.registerTool('machine_status', { description: 'CPU, memory, disk, uptime and server counts of the machine', inputSchema: z.object({}), annotations: read }, () =>
    run('machine.status', {})
  )
  server.registerTool(
    'list_servers',
    { description: 'Every game server with its id, game, status, ports and player count', inputSchema: z.object({}), annotations: read },
    () => run('servers.list', {})
  )
  server.registerTool('server_status', { description: 'One server: status, ports, what its admin tools support', inputSchema: z.object({ server_id: serverId }), annotations: read }, (a) =>
    run('servers.get', { id: a.server_id })
  )
  server.registerTool('list_players', { description: 'Players online on a server', inputSchema: z.object({ server_id: serverId }), annotations: read }, (a) =>
    run('servers.players', { id: a.server_id })
  )
  server.registerTool('list_bans', { description: 'Banned players of a server', inputSchema: z.object({ server_id: serverId }), annotations: read }, (a) =>
    run('servers.bans', { id: a.server_id })
  )
  server.registerTool(
    'list_games',
    { description: 'Games NeledPort can host, optionally filtered by name', inputSchema: z.object({ search: z.string().max(80).optional() }), annotations: read },
    async (a): Promise<CallToolResult> => {
      try {
        const q = a.search?.toLowerCase() ?? ''
        const games = ((await o.call('games.list', {})) as { name: string }[]).filter((g) => g.name.toLowerCase().includes(q))
        return { content: [{ type: 'text', text: JSON.stringify(games, null, 2) }] }
      } catch (e) {
        return { content: [{ type: 'text', text: (e as Error).message }], isError: true }
      }
    }
  )
  server.registerTool(
    'console_output',
    {
      description: "The server's latest console lines",
      inputSchema: z.object({ server_id: serverId, lines: z.number().int().min(1).max(500).optional() }),
      annotations: read
    },
    (a) => run('servers.lines', { id: a.server_id, last: a.lines ?? 100 })
  )

  for (const [name, method, description, destructive] of [
    ['start_server', 'servers.start', 'Start a server', false],
    ['stop_server', 'servers.stop', 'Save the world and stop a server (players are disconnected)', true],
    ['restart_server', 'servers.restart', 'Save, stop and start a server again (players are disconnected)', true],
    ['update_server', 'servers.update', 'Stop, update to the latest Steam build and start again if it was running', true],
    ['backup_server', 'servers.backup', "Back up a server's saves now", false]
  ] as const) {
    server.registerTool(name, { description, inputSchema: z.object({ server_id: serverId }), annotations: act(destructive) }, (a) => run(method, { id: a.server_id }))
  }
  server.registerTool(
    'run_command',
    {
      description: "Run one command on the game's own console (RCON or stdin) and return its reply",
      inputSchema: z.object({ server_id: serverId, command: z.string().min(1).max(500) }),
      annotations: act(true)
    },
    (a) => run('servers.command', { id: a.server_id, command: a.command })
  )
  server.registerTool('kick_player', { description: 'Kick a player', inputSchema: z.object({ server_id: serverId, ...player, reason }), annotations: act(true) }, (a) =>
    run('servers.kick', { id: a.server_id, player: { id: a.player_id, name: a.player_name }, reason: a.reason })
  )
  server.registerTool('ban_player', { description: 'Ban a player', inputSchema: z.object({ server_id: serverId, ...player, reason }), annotations: act(true) }, (a) =>
    run('servers.ban', { id: a.server_id, player: { id: a.player_id, name: a.player_name }, reason: a.reason })
  )
  server.registerTool(
    'unban_player',
    { description: 'Lift a ban (ids from list_bans)', inputSchema: z.object({ server_id: serverId, ban_id: z.string().max(200) }), annotations: act(false) },
    (a) => run('servers.unban', { id: a.server_id, banId: a.ban_id })
  )

  if (o.allowCreate) {
    server.registerTool(
      'create_server',
      {
        description: 'Create a server for a catalog game (ids from list_games) in the default folder; install it next',
        inputSchema: z.object({
          game_id: z.string().max(80),
          name: z.string().min(1).max(80),
          settings: z.record(z.string(), z.string().max(500)).optional().describe('Game settings by key; defaults are used for the rest')
        }),
        annotations: act(false)
      },
      (a) => run('servers.create', { gameId: a.game_id, name: a.name, settings: a.settings })
    )
    server.registerTool(
      'install_server',
      { description: 'Download the server files with SteamCMD (can take a long time)', inputSchema: z.object({ server_id: serverId }), annotations: act(false) },
      (a) => run('servers.install', { id: a.server_id })
    )
  }
  return server
}
