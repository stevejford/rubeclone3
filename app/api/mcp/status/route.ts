import { NextRequest, NextResponse } from 'next/server'
import { requireMcpEnabled } from '@/lib/mcp/config'
import { getWorkspaceTools } from '@/lib/db/queries'

export async function GET(req: NextRequest) {
  try {
    requireMcpEnabled()
    const ws = req.nextUrl.searchParams.get('workspaceId')
    if (!ws || !Number.isFinite(Number(ws))) {
      return NextResponse.json({ error: 'workspaceId required' }, { status: 400 })
    }
    const tools = await getWorkspaceTools(Number(ws))
    return NextResponse.json({
      workspaceId: Number(ws),
      tools: tools.map(t => ({
        toolSlug: t.tool_slug,
        enabled: t.is_enabled,
        connectionId: t.connection_id,
      }))
    })
  } catch (e: any) {
    const status = e?.status ?? 500
    return NextResponse.json({ error: e?.message || 'Internal Server Error' }, { status })
  }
}
