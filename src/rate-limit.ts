import { createMiddleware } from 'hono/factory'
import { clientIp, failure } from './http.js'

const limits = { read: 360, write: 90 }
const windowMs = 60_000
const maxClients = 10_000

export function publicRateLimit(proxyHops: number) {
  const clients = new Map<string, { read: number; write: number }>()
  let resetAt = 0

  return createMiddleware(async (c, next) => {
    const { method } = c.req
    if (method === 'OPTIONS') return next()

    const now = Date.now()
    if (now >= resetAt) {
      clients.clear()
      resetAt = now + windowMs
    }

    const address = clientIp(c, proxyHops) ?? 'unknown'
    const category = method === 'GET' || method === 'HEAD' ? 'read' : 'write'
    const existing = clients.get(address)
    if (existing ? existing[category] >= limits[category] : clients.size >= maxClients) {
      c.header('Retry-After', String(Math.ceil((resetAt - now) / 1000)))
      return failure(c, 'Too many requests. Try again shortly.', 429)
    }

    const usage = existing ?? { read: 0, write: 0 }
    usage[category]++
    if (!existing) clients.set(address, usage)
    return next()
  })
}
