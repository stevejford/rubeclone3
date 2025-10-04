import { NextRequest } from 'next/server'
import { buildMcpServer, attachHandlers, createNodeStreamTransport } from '@/lib/mcp/server'
import { requireMcpEnabled } from '@/lib/mcp/config'
import { verifyToken } from '@/lib/mcp/token'
import { aiConfig } from '@/lib/env'
import { getWorkspaceTools } from '@/lib/db/queries'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    requireMcpEnabled()
    const secret = process.env.MCP_TOKEN_SECRET || aiConfig().composio.apiKey || ''
    const authz = req.headers.get('authorization') || ''
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : ''
    const verify = token ? verifyToken(token, secret) : { valid: false }
    if (!verify.valid) {
      return new Response('Unauthorized', { status: 401 })
    }

    const { transport, input, output } = createNodeStreamTransport()
    const server = buildMcpServer({
      listTools: async (request) => {
        const qp = request.nextUrl.searchParams
        const workspaceId = qp.get('workspaceId')
        if (!workspaceId) return []
        const wsId = parseInt(workspaceId, 10)
        if (!Number.isFinite(wsId) || wsId <= 0) return []
        const tools = await getWorkspaceTools(wsId)
        return tools
          .filter(t => t.is_enabled)
          .map(t => ({
            name: t.tool_slug,
            description: `Workspace tool: ${t.tool_slug}`,
            inputSchema: { type: 'object', properties: {}, additionalProperties: true },
          }))
      },
      callTool: async (name, args) => {
        // For Phase 2, we proxy to existing execute endpoint to reuse auth/logic
        // You can later inline the execution via composio client
        const res = await fetch(new URL('/api/composio/execute', req.nextUrl.origin), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: req.headers.get('cookie') || '' },
          body: JSON.stringify({
            workspaceId: (verify as any).payload?.workspaceId,
            toolSlug: name,
            action: args?.action || 'default',
            parameters: args || {},
          })
        })
        if (!res.ok) {
          const text = await res.text()
          return `Execution failed: ${res.status} ${text}`
        }
        const json = await res.json()
        return json
      },
    })

    attachHandlers(server, req, {
      listTools: async (r) => await (server as any).handlers.get('tools/list')(r),
      callTool: async (n, a, r) => await (server as any).handlers.get('tools/call')({ name: n, arguments: a }, r),
    } as any)

    await server.connect(transport)

    const stream = new ReadableStream({
      start(controller) {
        output.on('data', (chunk) => controller.enqueue(chunk))
        output.on('end', () => controller.close())
        output.on('error', (err) => controller.error(err))
      },
      cancel() {
        input.end()
      },
    })

    // Kick off handshake by piping initial newline
    input.write('\n')

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Transfer-Encoding': 'chunked',
      },
    })
  } catch (e: any) {
    const status = e?.status ?? 500
    return new Response(e?.message || 'Internal Server Error', { status })
  }
}
