import { NextRequest, NextResponse } from 'next/server'
import { requireMcpEnabled } from '@/lib/mcp/config'

export async function GET(req: NextRequest) {
  try {
    requireMcpEnabled()
    // Minimal: return stream endpoint template; client uses /servers to get signed URL
    const workspaceId = req.nextUrl.searchParams.get('workspaceId')
    if (!workspaceId) return NextResponse.json({ servers: [] })
    const url = new URL('/api/mcp/stream', req.nextUrl.origin)
    url.searchParams.set('workspaceId', workspaceId)
    return NextResponse.json({ servers: [{ id: `ws-${workspaceId}`, url: url.toString() }] })
  } catch (e: any) {
    const status = e?.status ?? 500
    return NextResponse.json({ error: e?.message || 'Internal Server Error' }, { status })
  }
}
