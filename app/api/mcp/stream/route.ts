import { NextRequest, NextResponse } from 'next/server'
import { requireMcpEnabled } from '@/lib/mcp/config'
import { verifyToken } from '@/lib/mcp/token'
import { aiConfig } from '@/lib/env'
import { getWorkspaceTools } from '@/lib/db/queries'

export const runtime = 'nodejs'

interface JsonRpcRequest {
  jsonrpc: string
  id: string | number
  method: string
  params?: any
}

interface JsonRpcResponse {
  jsonrpc: string
  id: string | number
  result?: any
  error?: {
    code: number
    message: string
    data?: any
  }
}

async function verifyAuth(req: NextRequest): Promise<{ valid: boolean; payload?: any; error?: string }> {
  const secret = process.env.MCP_TOKEN_SECRET || aiConfig().composio.apiKey || ''

  // Try to get token from Authorization header first, then from query parameter
  const authz = req.headers.get('authorization') || ''
  let token = authz.startsWith('Bearer ') ? authz.slice(7) : ''

  // Fallback to query parameter if header is not present
  if (!token) {
    token = req.nextUrl.searchParams.get('token') || ''
  }

  return token ? verifyToken(token, secret) : { valid: false, error: 'No token provided' }
}

async function handleJsonRpcRequest(rpcReq: JsonRpcRequest, req: NextRequest, verify: any): Promise<JsonRpcResponse | null> {
  console.log('[MCP] Handling JSON-RPC request:', rpcReq.method)

  try {
    switch (rpcReq.method) {
      case 'initialize': {
        return {
          jsonrpc: '2.0',
          id: rpcReq.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
              logging: {}
            },
            serverInfo: {
              name: 'ai-tool-marketplace',
              version: '0.1.0'
            }
          }
        }
      }

      case 'notifications/initialized':
      case 'initialized': {
        // Notifications don't require a response
        console.log('[MCP] Client initialized notification received')
        return null
      }

      case 'tools/list': {
        const workspaceId = req.nextUrl.searchParams.get('workspaceId')
        if (!workspaceId) {
          return {
            jsonrpc: '2.0',
            id: rpcReq.id,
            result: { tools: [] }
          }
        }

        const wsId = parseInt(workspaceId, 10)
        if (!Number.isFinite(wsId) || wsId <= 0) {
          return {
            jsonrpc: '2.0',
            id: rpcReq.id,
            result: { tools: [] }
          }
        }

        const tools = await getWorkspaceTools(wsId)
        const toolsList: any[] = []
        for (const t of tools) {
          if (!t.is_enabled) continue
          // Primary tool action
          toolsList.push({
            name: t.tool_slug,
            description: `Workspace tool: ${t.tool_slug}. If not connected, call auth_${t.tool_slug} to authenticate.`,
            inputSchema: { type: 'object', properties: {}, additionalProperties: true },
          })
          // Auth helper to initiate OAuth and return a link
          toolsList.push({
            name: `auth_${t.tool_slug}`,
            description: `Authenticate/connect ${t.tool_slug} to this workspace. Returns a URL to complete OAuth.`,
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          })
        }

        console.log('[MCP] Returning', toolsList.length, 'tools')

        return {
          jsonrpc: '2.0',
          id: rpcReq.id,
          result: { tools: toolsList }
        }
      }

      case 'tools/call': {
        const { name, arguments: args } = rpcReq.params

        console.log('[MCP] Calling tool:', name, 'with args:', args)

        // If the tool is an auth helper, initiate OAuth and return a link
        if (typeof name === 'string' && name.startsWith('auth_')) {
          const toolkit = name.slice(5)
          const proto = req.headers.get('x-forwarded-proto') || 'http'
          const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000'
          const origin = `${proto}://${host}`
          const res = await fetch(new URL('/api/composio/connect', origin), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', cookie: req.headers.get('cookie') || '' },
            body: JSON.stringify({
              workspaceId: verify.payload?.workspaceId,
              toolkit,
              // Use marketplace flow so callback posts message and auto-closes popup
              source: 'marketplace',
            })
          })

          if (!res.ok) {
            const text = await res.text()
            return {
              jsonrpc: '2.0',
              id: rpcReq.id,
              result: {
                content: [
                  { type: 'text', text: `Authentication initiation failed for ${toolkit}: ${res.status} ${text}` }
                ]
              }
            }
          }

          const data = await res.json().catch(() => ({} as any))
          const link = data?.redirectUrl as string | undefined
          const msg = link
            ? `To connect ${toolkit}, open this link in a new tab and complete authentication: ${link}`
            : `Authentication response did not include a redirect URL for ${toolkit}.`

          return {
            jsonrpc: '2.0',
            id: rpcReq.id,
            result: { content: [{ type: 'text', text: msg }] }
          }
        }

        // Otherwise, proxy execution to existing endpoint
        const proto = req.headers.get('x-forwarded-proto') || 'http'
        const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000'
        const origin = `${proto}://${host}`
        const res = await fetch(new URL('/api/composio/execute', origin), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: req.headers.get('cookie') || '' },
          body: JSON.stringify({
            workspaceId: verify.payload?.workspaceId,
            toolSlug: name,
            action: args?.action || 'default',
            parameters: args || {},
          })
        })

        if (!res.ok) {
          const text = await res.text()
          return {
            jsonrpc: '2.0',
            id: rpcReq.id,
            error: {
              code: -32603,
              message: `Tool execution failed: ${res.status} ${text}`
            }
          }
        }

        const result = await res.json()

        return {
          jsonrpc: '2.0',
          id: rpcReq.id,
          result: {
            content: [
              {
                type: 'text',
                text: typeof result === 'string' ? result : JSON.stringify(result)
              }
            ]
          }
        }
      }

      default: {
        return {
          jsonrpc: '2.0',
          id: rpcReq.id,
          error: {
            code: -32601,
            message: `Method not found: ${rpcReq.method}`
          }
        }
      }
    }
  } catch (error: any) {
    console.error('[MCP] Error handling request:', error)
    return {
      jsonrpc: '2.0',
      id: rpcReq.id,
      error: {
        code: -32603,
        message: error.message || 'Internal error'
      }
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    requireMcpEnabled()

    const verify = await verifyAuth(req)

    if (!verify.valid) {
      console.error('[MCP] Unauthorized:', verify.error)
      return NextResponse.json(
        {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32600,
            message: `Unauthorized: ${verify.error}`
          }
        },
        { status: 401 }
      )
    }

    // Parse JSON-RPC request
    const rpcReq: JsonRpcRequest = await req.json()

    console.log('[MCP] Received request:', rpcReq.method, 'id:', rpcReq.id)

    // Handle the request
    const response = await handleJsonRpcRequest(rpcReq, req, verify)

    // If response is null (notification), return 204 No Content
    if (response === null) {
      console.log('[MCP] No response needed for:', rpcReq.method)
      return new NextResponse(null, { status: 204 })
    }

    console.log('[MCP] Sending response for:', rpcReq.method)

    return NextResponse.json(response, {
      headers: {
        'Content-Type': 'application/json',
      }
    })
  } catch (e: any) {
    console.error('[MCP] Error:', e)
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: e?.message || 'Parse error'
        }
      },
      { status: 500 }
    )
  }
}
