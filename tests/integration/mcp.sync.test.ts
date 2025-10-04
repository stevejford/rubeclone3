import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as syncPost } from '@/app/api/mcp/sync/route'

function makeReq(body: any) {
  const url = 'http://localhost/api/mcp/sync'
  const init: RequestInit = { method: 'POST', body: JSON.stringify(body) }
  // @ts-expect-error NextRequest init shape is broader; for tests this is fine
  return new NextRequest(url, init)
}

describe('mcp/sync', () => {
  it('rejects without workspaceId', async () => {
    const res = await syncPost(makeReq({ tools: [] }))
    expect(res.status).toBe(400)
  })
})
