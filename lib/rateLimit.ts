type Key = string

class MemoryLimiter {
  private windows: Map<Key, number[]> = new Map()
  constructor(private max: number, private windowMs: number) {}

  allow(key: Key) {
    const now = Date.now()
    const start = now - this.windowMs
    const arr = (this.windows.get(key) || []).filter(t => t > start)
    if (arr.length >= this.max) return false
    arr.push(now)
    this.windows.set(key, arr)
    return true
  }
}

const limiters: Record<string, MemoryLimiter> = {}

export function getLimiter(name: string, max = 5, windowMs = 60_000) {
  limiters[name] ||= new MemoryLimiter(max, windowMs)
  return limiters[name]
}

export function rateLimit(name: string, key: string, max = 5, windowMs = 60_000) {
  return getLimiter(name, max, windowMs).allow(key)
}
