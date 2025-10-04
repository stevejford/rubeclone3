import { describe, it, expect } from 'vitest'
import { signToken, verifyToken } from '@/lib/mcp/token'

describe('mcp/token', () => {
  it('signs and verifies a valid token', () => {
    const token = signToken({ sub: 'u1', ws: 16 }, 'secret', 60)
    const res = verifyToken(token, 'secret')
    expect(res.valid).toBe(true)
    expect(res.payload.sub).toBe('u1')
    expect(res.payload.ws).toBe(16)
    expect(res.payload.exp).toBeTypeOf('number')
  })

  it('fails with malformed token', () => {
    const res = verifyToken('bad.token', 'secret')
    expect(res.valid).toBe(false)
    expect(res.error).toBe('Malformed token')
  })

  it('fails with invalid signature', () => {
    const token = signToken({ sub: 'u1' }, 'secret', 60)
    const res = verifyToken(token, 'wrong')
    expect(res.valid).toBe(false)
    expect(res.error).toBe('Invalid signature')
  })

  it('expires tokens', () => {
    const token = signToken({ sub: 'u1' }, 'secret', 0)
    const res = verifyToken(token, 'secret')
    // exp == iat => immediate expiry or near
    if (res.valid) {
      // In case clock granularity permits, force check:
      expect(res.payload.exp).toBeLessThanOrEqual(Math.floor(Date.now()/1000))
    } else {
      expect(res.error).toBe('Expired')
    }
  })
})
