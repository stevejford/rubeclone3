import { describe, it, expect } from 'vitest'
import { encodeState, decodeState } from '@/lib/composioClient'

describe('composio state', () => {
  it('roundtrips encode/decode', () => {
    const s = encodeState('u1', '16', 'github', 'marketplace')
    const d = decodeState(s)
    expect(d.userId).toBe('u1')
    expect(d.workspaceId).toBe('16')
    expect(d.toolkit).toBe('github')
    expect(d.source).toBe('marketplace')
    expect(typeof d.timestamp).toBe('number')
  })

  it('rejects expired state', () => {
    const s = encodeState('u1', '16', 'github', 'workspace')
    // tamper timestamp to past
    const obj = JSON.parse(Buffer.from(s, 'base64url').toString())
    obj.timestamp = Date.now() - (2 * 60 * 60 * 1000)
    const expired = Buffer.from(JSON.stringify(obj)).toString('base64url')
    expect(() => decodeState(expired)).toThrow(/expired/i)
  })

  it('rejects invalid payload', () => {
    const bad = Buffer.from(JSON.stringify({ a: 1 })).toString('base64url')
    expect(() => decodeState(bad)).toThrow(/invalid state/i)
  })
})
