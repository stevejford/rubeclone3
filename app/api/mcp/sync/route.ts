import { NextRequest, NextResponse } from 'next/server'
import { requireMcpEnabled } from '@/lib/mcp/config'

// Placeholder for syncing server state with workspace tools (no-op for now)
export async function POST(req: NextRequest) {
  try {
    requireMcpEnabled()
    const { workspaceId } = await req.json().catch(() => ({}))
    if (!workspaceId || !Number.isFinite(Number(workspaceId))) {
      return NextResponse.json({ error: 'workspaceId required' }, { status: 400 })
    }
    // In the future, refresh registry/tool cache here if needed
    return NextResponse.json({ success: true, workspaceId: Number(workspaceId), synced: true })
  } catch (e: any) {
    const status = e?.status ?? 500
    return NextResponse.json({ error: e?.message || 'Internal Server Error' }, { status })
  }
}
