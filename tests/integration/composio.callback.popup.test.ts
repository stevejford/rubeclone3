import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET as callbackGet } from '@/app/api/composio/callback/route'
import { getServerSession } from 'next-auth'

vi.mock('next-auth', async () => {
  const actual = await vi.importActual<any>('next-auth')
  return { ...actual, getServerSession: vi.fn() }
})

function makeReq(url: string) {
  // @ts-expect-error accept broader init shape for tests
  return new NextRequest(url)
}

describe('composio/callback marketplace popup messaging', () => {
  beforeEach(() => {
    vi.mocked(getServerSession as any).mockResolvedValue({ user: { id: '1' } })
  })
  it('returns HTML with postMessage on hosted success', async () => {
    const url = 'http://localhost/api/composio/callback?success=true&toolkit=github&userId=u1&connectionId=ca_1'
    const res = await callbackGet(makeReq(url))
    expect(res.headers.get('content-type')).toContain('text/html')
    const text = await res.text()
    expect(text).toContain("postMessage({")
    expect(text).toContain("'composio-auth-success'")
    expect(text).toContain("github")
  })
})
