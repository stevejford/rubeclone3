import { NextRequest, NextResponse } from 'next/server'
import { requireMcpEnabled } from '@/lib/mcp/config'
import { signToken } from '@/lib/mcp/token'
import { aiConfig } from '@/lib/env'

export async function POST(req: NextRequest) {
  try {
    requireMcpEnabled()
    const body = await req.json().catch(() => ({}))
    const { workspaceId } = body
    if (!workspaceId || !Number.isFinite(Number(workspaceId))) {
      return NextResponse.json({ error: 'workspaceId required' }, { status: 400 })
    }
    const secret = process.env.MCP_TOKEN_SECRET || aiConfig().composio.apiKey || ''
    if (!secret) return NextResponse.json({ error: 'MCP secret unavailable' }, { status: 503 })

    const token = signToken({ workspaceId: Number(workspaceId) }, secret, 600)
    const url = new URL('/api/mcp/stream', req.nextUrl.origin)
    url.searchParams.set('workspaceId', String(workspaceId))
    return NextResponse.json({ url: url.toString(), token })
  } catch (e: any) {
    const status = e?.status ?? 500
    return NextResponse.json({ error: e?.message || 'Internal Server Error' }, { status })
  }
}
