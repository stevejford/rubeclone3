import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET as statusGet } from '@/app/api/mcp/status/route'

function makeReq(url: string) {
  return new NextRequest(url)
}

describe('mcp/status', () => {
  it('400 when workspaceId is missing or invalid', async () => {
    const res1 = await statusGet(makeReq('http://localhost/api/mcp/status'))
    expect(res1.status).toBe(400)
    const res2 = await statusGet(makeReq('http://localhost/api/mcp/status?workspaceId=NaN'))
    expect(res2.status).toBe(400)
  })
})
