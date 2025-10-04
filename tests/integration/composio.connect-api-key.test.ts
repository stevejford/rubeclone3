import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import * as queries from '@/lib/db/queries'
import { POST as connectApiKey } from '@/app/api/composio/connect-api-key/route'
import { getServerSession } from 'next-auth'

vi.mock('next-auth', async () => {
  const actual = await vi.importActual<any>('next-auth')
  return { ...actual, getServerSession: vi.fn() }
})

vi.mock('@/lib/db/queries', async () => {
  const actual = await vi.importActual<any>('@/lib/db/queries')
  return {
    ...actual,
    getWorkspaceWithPermissions: vi.fn(async () => ({ id: 16, owner_id: 1, type: 'team', members: [] })),
    enableWorkspaceTool: vi.fn(async () => ({})),
  }
})

vi.mock('@/lib/composio-mcp', async () => {
  const actual = await vi.importActual<any>('@/lib/composio-mcp')
  return {
    ...actual,
    getComposioMCPClient: () => ({ connectWithApiKey: vi.fn(async () => ({ success: true, connectionId: 'ca_test' })) }),
  }
})

function makeReq(body: any) {
  const url = 'http://localhost/api/composio/connect-api-key'
  const init: RequestInit = { method: 'POST', body: JSON.stringify(body) }
  // @ts-expect-error NextRequest init shape is broader; for tests this is fine
  return new NextRequest(url, init)
}

describe('composio/connect-api-key', () => {
  beforeEach(() => {
    vi.mocked(getServerSession as any).mockResolvedValue({ user: { id: '1' } })
  })

  it('connects with API key and enables tool', async () => {
    const res = await connectApiKey(makeReq({ workspaceId: '16', toolkit: 'openai', apiKey: 'sk-test' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.connectionId).toBe('ca_test')
    expect(vi.mocked((queries as any).enableWorkspaceTool)).toHaveBeenCalled()
  })
})
