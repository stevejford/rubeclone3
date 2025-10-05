import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { getAuthOptions } from '@/lib/auth'
import { executeTool } from '@/lib/composio'
import { getWorkspaceWithPermissions, getWorkspaceTool, recordToolUsage, getWorkspaceOwnerId } from '@/lib/db/queries'
import { aiConfig } from '@/lib/env'
import { verifyToken } from '@/lib/mcp/token'

/**
 * Tool execution proxy endpoint for secure tool operations
 * POST /api/composio/execute
 */

const executeRequestSchema = z.object({
  workspaceId: z.string().transform(Number),
  toolSlug: z.string().min(1).max(100),
  action: z.string().min(1).max(100),
  parameters: z.record(z.any()).default({}),
})

export async function POST(request: NextRequest) {
  try {
    // Check if Composio is enabled
    if (!aiConfig().composio.enabled) {
      return NextResponse.json(
        { error: 'Composio integration is not enabled' },
        { status: 503 }
      )
    }

    // Verify user authentication
    const session = await getServerSession(getAuthOptions())
    // Allow either NextAuth session OR a valid MCP token for server-originated calls
    let mcpAuth: { valid: boolean; payload?: any } | null = null
    if (!session?.user?.id) {
      const secret = process.env.MCP_TOKEN_SECRET || aiConfig().composio.apiKey || ''
      const authz = request.headers.get('authorization') || ''
      let token = authz.startsWith('Bearer ') ? authz.slice(7) : ''
      if (!token) token = new URL(request.url).searchParams.get('token') || ''
      if (token && secret) {
        mcpAuth = verifyToken(token, secret)
      }
      if (!mcpAuth?.valid) {
        return NextResponse.json(
          { error: 'Authentication required' },
          { status: 401 }
        )
      }
    }

    // Parse and validate request body
    const body = await request.json()
    const parseResult = executeRequestSchema.safeParse(body)
    
    if (!parseResult.success) {
      return NextResponse.json(
        { 
          error: 'Invalid request data',
          details: parseResult.error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message
          }))
        },
        { status: 400 }
      )
    }

    const { workspaceId, toolSlug, action, parameters } = parseResult.data

    // Verify workspace access permissions
    const requesterUserId = session?.user?.id ? parseInt(session.user.id) : undefined
    const workspace = await getWorkspaceWithPermissions(workspaceId, requesterUserId ?? -1)
    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      )
    }

    // Check if user has access to the workspace (skip for valid MCP token)
    if (!mcpAuth?.valid) {
      const hasAccess = workspace.owner_id === parseInt(session!.user!.id) ||
                       workspace.members?.some((m: any) => m.user_id === parseInt(session!.user!.id))
      if (!hasAccess) {
        return NextResponse.json(
          { error: 'Access denied to workspace' },
          { status: 403 }
        )
      }
    } else {
      // If MCP token was used, ensure the token workspace matches the request body
      if (Number(mcpAuth.payload?.workspaceId) !== workspaceId) {
        return NextResponse.json(
          { error: 'Workspace token mismatch' },
          { status: 403 }
        )
      }
    }

    // Verify tool is enabled for the workspace
    const workspaceTool = await getWorkspaceTool(workspaceId, toolSlug)
    if (!workspaceTool || !workspaceTool.is_enabled) {
      return NextResponse.json(
        { error: 'Tool is not enabled for this workspace' },
        { status: 403 }
      )
    }

    // Check if tool has an active connection
    const cfg = workspaceTool.config as any
    if (!workspaceTool.connection_id && !cfg?.connectionId) {
      return NextResponse.json(
        { error: 'Tool is not connected. Please connect the tool first.' },
        { status: 400 }
      )
    }

    // Validate connection status from config
    if (cfg?.connectionStatus !== 'connected') {
      return NextResponse.json(
        { error: 'Tool connection is not active. Please reconnect the tool.' },
        { status: 400 }
      )
    }

    // Execute the tool action via Composio SDK
    // Determine a userId to execute as: prefer session user; else tool enabled_by; else workspace owner
    let execUserId = session?.user?.id ? session.user.id : undefined
    if (!execUserId) {
      execUserId = String(workspaceTool.enabled_by || (await getWorkspaceOwnerId(workspaceId)) || '0')
    }

    const executionResult = await executeTool(
      execUserId,
      workspaceId.toString(),
      workspace.type === 'personal',
      toolSlug,
      action,
      parameters
    )

    // Record usage statistics for billing and analytics
    try {
      await recordToolUsage(
        parseInt(execUserId),
        workspaceId,
        toolSlug,
        new Date()
      )
    } catch (usageError) {
      // Log but don't fail the request for usage tracking errors
      console.error('Failed to record tool usage:', usageError)
    }

    // Return execution results
    if (executionResult.success) {
      return NextResponse.json({
        success: true,
        data: executionResult.data,
        executionId: executionResult.executionId,
        toolkit: toolSlug,
        action,
        timestamp: new Date().toISOString(),
      })
    } else {
      return NextResponse.json(
        {
          success: false,
          error: executionResult.error || 'Tool execution failed',
          toolkit: toolSlug,
          action,
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      )
    }

  } catch (error) {
    console.error('Composio execute error:', error)
    
    // Handle specific error types
    if (error instanceof Error) {
      if (error.message.includes('Composio client not available')) {
        return NextResponse.json(
          { error: 'Composio service is temporarily unavailable' },
          { status: 503 }
        )
      }
      
      if (error.message.includes('Invalid parameters')) {
        return NextResponse.json(
          { error: 'Invalid parameters provided for tool execution' },
          { status: 400 }
        )
      }
      
      if (error.message.includes('Rate limit')) {
        return NextResponse.json(
          { error: 'Rate limit exceeded. Please try again later.' },
          { status: 429 }
        )
      }
      
      if (error.message.includes('Connection expired')) {
        return NextResponse.json(
          { error: 'Tool connection has expired. Please reconnect the tool.' },
          { status: 401 }
        )
      }
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json(
    { error: 'Method not allowed. Use POST to execute tools.' },
    { status: 405 }
  )
}
