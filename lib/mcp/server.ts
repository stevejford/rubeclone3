import { NextRequest } from 'next/server'
import { Server } from '@modelcontextprotocol/sdk/server'
import { PassThrough } from 'stream'
import path from 'path'

type ToolDef = any

export interface McpServerOptions {
  listTools: (req: NextRequest) => Promise<ToolDef[]>
  callTool: (name: string, args: any, req: NextRequest) => Promise<any>
}

export function buildMcpServer(_opts?: McpServerOptions) {
  const server = new Server({ name: 'ai-tool-marketplace', version: '0.1.0' }, { capabilities: { logging: {} } })
  return server
}

export function attachHandlers(server: Server, req: NextRequest, opts: McpServerOptions) {
  // Resolve schemas at runtime to avoid bundler export issues
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pkgPath = require.resolve('@modelcontextprotocol/sdk/package.json')
  const baseDir = path.dirname(pkgPath)
  const typesPath = path.join(baseDir, 'types.js')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ListToolsRequestSchema, CallToolRequestSchema } = require(typesPath)

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: await opts.listTools(req) }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    const name = request.params.name
    const args = request.params.arguments ?? {}
    const result = await opts.callTool(name, args, req)
    return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }] }
  })
}

export function createNodeStreamTransport() {
  // Use a PassThrough to bridge Node streams for Next Response streaming
  const input = new PassThrough()
  const output = new PassThrough()
  // Resolve stdio transport at runtime to avoid bundler export issues
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pkgPath = require.resolve('@modelcontextprotocol/sdk/package.json')
  const baseDir = path.dirname(pkgPath)
  const stdioPath = path.join(baseDir, 'server/stdio.js')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { StdioServerTransport } = require(stdioPath)
  const transport = new StdioServerTransport(input as any, output as any)
  return { transport, input, output }
}
