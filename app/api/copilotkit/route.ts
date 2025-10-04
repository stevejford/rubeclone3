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

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getOrigin(req: NextRequest) {
  const proto = req.headers.get('x-forwarded-proto') || 'http'
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000'
  return `${proto}://${host}`
}

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
    const signed = await fetch(new URL('/api/mcp/servers', getOrigin(req)), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId })
    }).then(async r => {
      if (!r.ok) {
        const t = await r.text().catch(() => '')
        throw new Error(`servers POST failed: ${r.status} ${t}`)
      }
      return r.json()
    })
    if (!signed?.url || !signed?.token) {
      return new Response('Failed to configure MCP', { status: 500 })
    }

    logger.info('mcp_config_received', { requestId, url: signed.url, hasToken: !!signed.token })

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      logger.error('anthropic_api_key_missing', { requestId })
      return new Response('Anthropic not configured', { status: 500 })
    }

    logger.info('anthropic_setup', { requestId, hasApiKey: !!apiKey })
    const serviceAdapter = new AnthropicAdapter({ model: 'claude-3-5-sonnet-20241022' })

    // Load actions before creating runtime
    logger.info('loading_actions_start', { requestId })
    const mcp = new MCPClient({ url: signed.url, token: signed.token })
    let actions: any[] = []

    try {
      await mcp.connect()
      const toolsRes: any = await mcp.listTools()
      const enabled = (await getWorkspaceTools(Number(workspaceId)))
        .filter(t => t.is_enabled)
        .map(t => t.tool_slug)
      const allowed = new Set<string>(enabled.flatMap((slug: string) => [slug, `auth_${slug}`]))
      const filtered = (toolsRes?.tools || []).filter((t: any) => allowed.has(t.name))
      actions = filtered.map((tool: any) =>
        MCPToolConverter.convertMCPToolToAction(tool, async (args: any) => {
          logger.info('mcp_tool_call_start', { requestId, tool: tool.name, userId, workspaceId })
          try {
            const res: any = await mcp.callTool({ name: tool.name, arguments: args })
            logger.info('mcp_tool_call_success', { requestId, tool: tool.name })
            if (Array.isArray(res?.content) && res.content[0]) {
              return (res.content[0] as any).text || JSON.stringify(res.content[0])
            }
            return typeof res === 'string' ? res : JSON.stringify(res)
          } catch (e: any) {
            const msg = e?.message || String(e)
            logger.error('mcp_tool_call_error', { requestId, tool: tool.name, error: msg })

            // If the tool isn't authenticated, try to initiate auth via auth_<tool> helper
            const needsAuth = /401|Authentication required/i.test(msg)
            if (needsAuth) {
              try {
                const authToolName = `auth_${tool.name}`
                const authRes: any = await mcp.callTool({ name: authToolName, arguments: {} })
                if (Array.isArray(authRes?.content) && authRes.content[0]) {
                  const text = (authRes.content[0] as any).text || JSON.stringify(authRes.content[0])
                  return text
                }
                return typeof authRes === 'string' ? authRes : JSON.stringify(authRes)
              } catch (authErr: any) {
                const aMsg = authErr?.message || String(authErr)
                logger.error('mcp_tool_auth_error', { requestId, tool: tool.name, error: aMsg })
                return 'Authentication is required for this tool but initiating OAuth failed. Please try again from the Tools page.'
              }
            }
            throw e
          }
        })
      )
      logger.info('loading_actions_success', { requestId, count: actions.length })
    } catch (e: any) {
      logger.error('loading_actions_error', { requestId, error: e?.message || String(e) })
      // Continue with empty actions
    }

    const runtime = new CopilotRuntime({
      actions,
    })

    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({ runtime, serviceAdapter, endpoint: '/api/copilotkit' })
    logger.info('agent_runtime_start', { requestId, userId, workspaceId })

    try {
      const response = await handleRequest(req)
      logger.info('agent_runtime_success', { requestId })
      return response
    } catch (error: any) {
      logger.error('agent_runtime_error', {
        requestId,
        errorMessage: error?.message,
        errorName: error?.name,
        errorStack: error?.stack,
        errorString: String(error)
      })
      throw error
    }
  } catch (e: any) {
    logger.error('agent_runtime_outer_error', {
      requestId,
      errorMessage: e?.message,
      errorName: e?.name,
      errorStack: e?.stack,
      errorString: String(e),
      errorCode: e?.code,
      errorCause: e?.cause
    })
    return new Response(JSON.stringify({ error: e?.message || 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
