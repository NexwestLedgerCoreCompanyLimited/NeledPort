import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { createMcpServer } from './mcp'

/** Serves MCP on stdin/stdout until the AI client closes it. Nothing else may write to stdout here. */
export async function startMcp(o: Parameters<typeof createMcpServer>[0]): Promise<void> {
  await createMcpServer(o).connect(new StdioServerTransport())
  await new Promise<void>((resolve) => process.stdin.once('close', resolve))
}
