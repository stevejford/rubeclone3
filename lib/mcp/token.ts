import crypto from 'crypto'

function b64url(input: Buffer | string) {
  return (typeof input === 'string' ? Buffer.from(input) : input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

export function signToken(payload: Record<string, any>, secret: string, expiresInSec = 600) {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const body = { ...payload, iat: now, exp: now + expiresInSec }
  const part1 = b64url(JSON.stringify(header))
  const part2 = b64url(JSON.stringify(body))
  const data = `${part1}.${part2}`
  const sig = crypto.createHmac('sha256', secret).update(data).digest()
  return `${data}.${b64url(sig)}`
}

export function verifyToken(token: string, secret: string): { valid: boolean; payload?: any; error?: string } {
  try {
    const [p1, p2, sig] = token.split('.')
    if (!p1 || !p2 || !sig) return { valid: false, error: 'Malformed token' }
    const data = `${p1}.${p2}`
    const expected = b64url(crypto.createHmac('sha256', secret).update(data).digest())
    if (expected !== sig) return { valid: false, error: 'Invalid signature' }
    const payload = JSON.parse(Buffer.from(p2, 'base64').toString('utf8'))
    const now = Math.floor(Date.now() / 1000)
    if (payload.exp && now > payload.exp) return { valid: false, error: 'Expired' }
    return { valid: true, payload }
  } catch (e: any) {
    return { valid: false, error: e?.message || 'Invalid token' }
  }
}
