import { NextRequest } from 'next/server'
import { createServer, StdioServerTransport, Server } from '@modelcontextprotocol/sdk/server'
import { tools as toolsApi } from '@modelcontextprotocol/sdk/types'
import { PassThrough } from 'stream'

type ToolDef = toolsApi.Tool

export interface McpServerOptions {
  listTools: (req: NextRequest) => Promise<ToolDef[]>
  callTool: (name: string, args: any, req: NextRequest) => Promise<any>
}

export function buildMcpServer(opts: McpServerOptions) {
  const server = createServer()

  server.setRequestHandler(toolsApi.listTools, async () => {
    // We pass a dummy request here; route layer injects the real one
    throw new Error('listTools must be wired via stream handler with request context')
  })

  server.setRequestHandler(toolsApi.callTool, async () => {
    throw new Error('callTool must be wired via stream handler with request context')
  })

  return server
}

export function attachHandlers(server: Server, req: NextRequest, opts: McpServerOptions) {
  server.setRequestHandler(toolsApi.listTools, async () => {
    return { tools: await opts.listTools(req) }
  })

  server.setRequestHandler(toolsApi.callTool, async (params) => {
    const result = await opts.callTool(params.name, params.arguments ?? {}, req)
    return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }] }
  })
}

export function createNodeStreamTransport() {
  // Use a PassThrough to bridge Node streams for Next Response streaming
  const input = new PassThrough()
  const output = new PassThrough()
  const transport = new StdioServerTransport({
    input: input as any,
    output: output as any,
  })
  return { transport, input, output }
}
