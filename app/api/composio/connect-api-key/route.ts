import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { getAuthOptions } from '@/lib/auth'
import { getComposioMCPClient } from '@/lib/composio-mcp'
import { getWorkspaceWithPermissions, enableWorkspaceTool } from '@/lib/db/queries'
import { logger } from '@/lib/log'
import { rateLimit } from '@/lib/rateLimit'
import { aiConfig } from '@/lib/env'

/**
 * API endpoint for connecting with API keys via Composio
 * POST /api/composio/connect-api-key
 */

const connectApiKeySchema = z.object({
  workspaceId: z.string().transform(Number),
  toolkit: z.string().min(1).max(50),
  apiKey: z.string().min(1).max(500),
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
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    // Parse and validate request body
    const body = await request.json()
    const parseResult = connectApiKeySchema.safeParse(body)
    
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

    const { workspaceId, toolkit, apiKey } = parseResult.data

    // Verify workspace permissions (owner/admin only)
    const workspace = await getWorkspaceWithPermissions(workspaceId, parseInt(session.user.id))
    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      )
    }

    // Check if user has permission to manage tools (owner or admin)
    const userRole = workspace.owner_id === parseInt(session.user.id) ? 'owner' :
                    workspace.members?.find((m: any) => m.user_id === parseInt(session.user.id))?.role
    
    if (userRole !== 'owner' && userRole !== 'admin') {
      return NextResponse.json(
        { error: 'Insufficient permissions. Only workspace owners and admins can connect tools.' },
        { status: 403 }
      )
    }

    const requestId = `${session.user.id}:${workspaceId}:${toolkit}:${Date.now()}`
    const rlKey = `${session.user.id}:${workspaceId}:${toolkit}`
    if (!rateLimit('connect_api_key', rlKey, 10, 60_000)) {
      logger.warn('rate_limit_exceeded', { requestId, userId: session.user.id, workspaceId, toolkit })
      return NextResponse.json({
        error: 'Too many API key connect attempts. Please wait a minute and try again.',
        code: 'RATE_LIMITED',
        remediation: 'Wait at least 60 seconds before retrying connect.'
      }, { status: 429 })
    }
    logger.info('api_key_connect_start', { requestId, userId: session.user.id, workspaceId, toolkit })

    // Connect with API key using Composio MCP client
    const mcpClient = getComposioMCPClient()
    const connectionResult = await mcpClient.connectWithApiKey(session.user.id, toolkit, apiKey)

    if (connectionResult.success) {
      logger.info('api_key_connect_success', { requestId, toolkit, connectionId: connectionResult.connectionId })
      
      // Update workspace_tools table with connection details
      await enableWorkspaceTool(
        workspaceId,
        toolkit,
        parseInt(session.user.id),
        {
          connectionId: connectionResult.connectionId,
          connectionStatus: 'connected',
          authType: 'api_key',
          lastSync: new Date().toISOString(),
          connectedAt: new Date().toISOString(),
        }
      )

      return NextResponse.json({
        success: true,
        connectionId: connectionResult.connectionId,
        toolkit,
        message: `Successfully connected ${toolkit} with API key`
      })
    } else {
      logger.warn('api_key_connect_failed', { requestId, toolkit, error: connectionResult.error })
      return NextResponse.json({
        success: false,
        error: connectionResult.error || 'Failed to connect with API key'
      }, { status: 400 })
    }

  } catch (error) {
    logger.error('api_key_connect_error', { error: error instanceof Error ? error.message : String(error) })
    
    // Handle specific error types
    if (error instanceof Error) {
      if (error.message.includes('Composio client not available')) {
        return NextResponse.json(
          { error: 'Composio service is temporarily unavailable' },
          { status: 503 }
        )
      }
      
      if (error.message.includes('Invalid toolkit')) {
        return NextResponse.json(
          { error: 'The specified toolkit is not supported' },
          { status: 400 }
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
    { error: 'Method not allowed. Use POST to connect with API keys.' },
    { status: 405 }
  )
}