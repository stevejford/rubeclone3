import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { getAuthOptions } from '@/lib/auth'
import { isValidToolkit } from '@/lib/composio'
import { ComposioClient, encodeState, composioUserId } from '@/lib/composioClient'
import { getWorkspaceWithPermissions } from '@/lib/db/queries'
import { aiConfig } from '@/lib/env'
import { randomUUID } from 'crypto'
import { logger } from '@/lib/log'
import { rateLimit } from '@/lib/rateLimit'

/**
 * API endpoint for initiating Composio OAuth connections
 * POST /api/composio/connect
 */

const connectRequestSchema = z.object({
  workspaceId: z.preprocess(v => Number(v), z.number().int().positive()),
  toolkit: z.string().min(1).max(50),
  source: z.enum(['marketplace','workspace']).default('workspace'),
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
    const parseResult = connectRequestSchema.safeParse(body)
    
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

    const { workspaceId, toolkit, source } = parseResult.data

    // Validate toolkit name
    if (!isValidToolkit(toolkit)) {
      return NextResponse.json(
        { error: 'Invalid toolkit name' },
        { status: 400 }
      )
    }

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

    const requestId = randomUUID()
    const rlKey = `${session.user.id}:${workspaceId}:${toolkit}`
    if (!rateLimit('connect', rlKey, 5, 60_000)) {
      logger.warn('rate_limit_exceeded', { requestId, userId: session.user.id, workspaceId, toolkit })
      return NextResponse.json({
        error: 'Too many connect attempts. Please wait a minute and try again.',
        code: 'RATE_LIMITED',
        remediation: 'Wait at least 60 seconds before retrying connect.'
      }, { status: 429 })
    }
    logger.info('connect_start', { requestId, userId: session.user.id, workspaceId, toolkit, source, isPersonal: workspace.type === 'personal' })

    // Build callback URL from request origin and include fallbacks for source/state
    const state = encodeState(session.user.id, workspaceId.toString(), toolkit, source)
    const callbackUrlObj = new URL('/api/composio/callback', request.nextUrl.origin)
    callbackUrlObj.searchParams.set('source', source)
    callbackUrlObj.searchParams.set('backup_state', state)
    const callbackUrl = callbackUrlObj.toString()

    // Initiate OAuth via SDK facade
    const client = new ComposioClient()
    const connectionResult = await client.linkOAuth(
      composioUserId(session.user.id, workspaceId.toString(), workspace.type === 'personal'),
      toolkit,
      callbackUrl,
      state,
    )

    logger.info('connect_initiated', { requestId, redirectUrl: connectionResult.redirectUrl, state })

    return NextResponse.json({
      success: true,
      redirectUrl: connectionResult.redirectUrl,
      state: connectionResult.state,
      toolkit,
      workspaceId,
      requestId,
    })

  } catch (error) {
    logger.error('connect_failed', { error: error instanceof Error ? error.message : String(error) })
    
    // Handle specific error types
    if (error instanceof Error) {
      if (error.message.includes('Invalid toolkit')) {
        return NextResponse.json(
          { error: 'The specified toolkit is not supported' },
          { status: 400 }
        )
      }
      
      if (error.message.includes('Composio client not available')) {
        return NextResponse.json(
          { error: 'Composio service is temporarily unavailable' },
          { status: 503 }
        )
      }
      
      if (error.message.includes('Failed to initiate connection')) {
        return NextResponse.json(
          { error: 'Failed to initiate OAuth connection. Please try again.' },
          { status: 500 }
        )
      }
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json(
    { error: 'Method not allowed. Use POST to initiate connections.' },
    { status: 405 }
  )
}
