import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { getAuthOptions } from '@/lib/auth'
import { CopilotRuntime, AnthropicAdapter, copilotRuntimeNextJSAppRouterEndpoint } from '@copilotkit/runtime'
import { MCPClient } from '@/lib/mcp-client'
import { MCPToolConverter } from '@/lib/mcp-converter'
import { getWorkspaceWithPermissions, getWorkspaceTools } from '@/lib/db/queries'
import { logger } from '@/lib/log'
import { rateLimit } from '@/lib/rateLimit'
import { randomUUID } from 'crypto'
import Anthropic from '@anthropic-ai/sdk'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const requestId = randomUUID()
  try {
    const session = await getServerSession(getAuthOptions())
    if (!session?.user?.id) {
      return new Response('Unauthorized', { status: 401 })
    }

    const userId = parseInt(session.user.id)
    const workspaceId = req.headers.get('X-Workspace-ID')
    if (!workspaceId || !Number.isFinite(Number(workspaceId))) {
      return new Response('Missing workspace context', { status: 400 })
    }

    if (!rateLimit('copilot_runtime', `${userId}:${workspaceId}`, 20, 60_000)) {
      return new Response('Rate limit exceeded', { status: 429 })
    }

    const ws = await getWorkspaceWithPermissions(Number(workspaceId), userId)
    if (!ws) {
      return new Response('Forbidden', { status: 403 })
    }

    // Fetch signed MCP stream URL + token via existing helper
    const signed = await fetch(new URL('/api/mcp/servers', req.nextUrl.origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId })
    }).then(r => r.ok ? r.json() : null)
    if (!signed?.url || !signed?.token) {
      return new Response('Failed to configure MCP', { status: 500 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return new Response('Anthropic not configured', { status: 500 })
    }
    const anthropic: any = new Anthropic({ apiKey })
    const serviceAdapter = new AnthropicAdapter({ anthropic, model: 'claude-3-5-sonnet-latest' as any })

    const runtime = new CopilotRuntime({
      // CopilotRuntime types expect a synchronous factory; cast to any to allow async resolution of actions
      actions: ((): any => {
        return (async () => {
          const mcp = new MCPClient({ url: signed.url, token: signed.token })
          try {
            await mcp.connect()
            const toolsRes: any = await mcp.listTools()
            const enabled = (await getWorkspaceTools(Number(workspaceId)))
              .filter(t => t.is_enabled)
              .map(t => t.tool_slug)
            const filtered = (toolsRes?.tools || []).filter((t: any) => enabled.includes(t.name))
            const actions = filtered.map((tool: any) =>
              MCPToolConverter.convertMCPToolToAction(tool, async (args: any) => {
                logger.info('mcp_tool_call_start', { requestId, tool: tool.name, userId, workspaceId })
                const res: any = await mcp.callTool({ name: tool.name, arguments: args })
                logger.info('mcp_tool_call_success', { requestId, tool: tool.name })
                try {
                  if (Array.isArray(res?.content) && res.content[0]) {
                    return (res.content[0] as any).text || JSON.stringify(res.content[0])
                  }
                  return typeof res === 'string' ? res : JSON.stringify(res)
                } catch {
                  return 'Tool executed.'
                }
              })
            )
            logger.info('agent_actions_loaded', { requestId, count: actions.length })
            return actions
          } catch (e: any) {
            logger.error('agent_actions_error', { requestId, error: e?.message || String(e) })
            return []
          } finally {
            await mcp.close()
          }
        })()
      })() as any,
    })

    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({ runtime, serviceAdapter, endpoint: '/api/copilotkit' })
    logger.info('agent_runtime_start', { requestId, userId, workspaceId })
    return await handleRequest(req)
  } catch (e: any) {
    logger.error('agent_runtime_error', { requestId, error: e?.message || String(e) })
    return new Response('Internal Server Error', { status: 500 })
  }
}
