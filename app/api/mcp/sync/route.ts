import { NextRequest, NextResponse } from 'next/server'
import { requireMcpEnabled } from '@/lib/mcp/config'
import { enableWorkspaceTool, disableWorkspaceTool, getWorkspaceOwnerId } from '@/lib/db/queries'

type IncomingTool = {
  toolSlug: string
  enabled: boolean
  connectionId?: string
}

export async function POST(req: NextRequest) {
  try {
    requireMcpEnabled()

    const body = await req.json().catch(() => ({})) as { workspaceId?: number | string, tools?: IncomingTool[] }
    const wsIdRaw = body.workspaceId
    const tools = Array.isArray(body.tools) ? body.tools : []

    const wsId = Number(wsIdRaw)
    if (!wsId || !Number.isFinite(wsId) || wsId <= 0) {
      return NextResponse.json({ error: 'workspaceId required' }, { status: 400 })
    }

    // Use the workspace owner as the actor for enabling tools when syncing
    const ownerId = await getWorkspaceOwnerId(wsId)
    if (!ownerId) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    const results = {
      enabled: [] as string[],
      disabled: [] as string[],
      errors: [] as { toolSlug: string, error: string }[],
    }

    for (const t of tools) {
      const slug = (t.toolSlug || '').trim()
      if (!slug) continue

      try {
        if (t.enabled) {
          await enableWorkspaceTool(wsId, slug, ownerId, {
            connectionId: t.connectionId ?? null,
          })
          results.enabled.push(slug)
        } else {
          await disableWorkspaceTool(wsId, slug, {
            connectionId: t.connectionId ?? null,
          })
          results.disabled.push(slug)
        }
      } catch (err: any) {
        results.errors.push({ toolSlug: slug, error: err?.message || 'Unknown error' })
      }
    }

    return NextResponse.json({ success: true, workspaceId: wsId, ...results })
  } catch (e: any) {
    const status = e?.status ?? 500
    return NextResponse.json({ error: e?.message || 'Internal Server Error' }, { status })
  }
}
