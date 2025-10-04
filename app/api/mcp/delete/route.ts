import { NextResponse } from 'next/server'
import { requireMcpEnabled } from '@/lib/mcp/config'

export async function DELETE() {
  try {
    requireMcpEnabled()
    // No persisted servers yet; respond OK for API completeness
    return NextResponse.json({ success: true })
  } catch (e: any) {
    const status = e?.status ?? 500
    return NextResponse.json({ error: e?.message || 'Internal Server Error' }, { status })
  }
}
