import { createHash, randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import { getConnInfo } from '@hono/node-server/conninfo'
import { getCookie, setCookie } from 'hono/cookie'
import type { Context } from 'hono'
import type { Config } from './config.js'

export function digest(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function safeUrl(value: string) {
  try {
    const url = new URL(value)
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url
  } catch {
    return
  }
}

export function articleUrl(value: string) {
  const url = safeUrl(value)
  if (!url || value.length > 2000) return
  if (url.hash.startsWith('#comment-')) url.hash = ''
  if (url.href.length <= 2000) return url
}

export function clientIp(c: Context, proxyHops: number) {
  if (proxyHops) {
    const addresses = (c.req.header('X-Forwarded-For') ?? '').split(',').map((address) => address.trim())
    const address = addresses.at(-proxyHops)
    if (address && isIP(address)) return address
  }
  try {
    return getConnInfo(c).remote.address ?? null
  } catch {
    return null
  }
}

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

export function visitor(c: Context) {
  const token = c.req.header('X-Kucos-Visitor') ?? getCookie(c, 'kucos')
  return token && uuid.test(token) ? digest(token.toLowerCase()) : undefined
}

export function writeVisitor(c: Context, config: Config) {
  const existing = visitor(c)
  if (existing) return existing

  const token = randomUUID()
  const secure = config.publicUrl.startsWith('https:')
  setCookie(c, 'kucos', token, {
    httpOnly: true, secure, sameSite: secure ? 'None' : 'Lax', path: '/', maxAge: 60 * 60 * 24 * 365,
  })
  return digest(token)
}

export async function requestBody(c: Context) {
  const type = c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase()
  try {
    if (type === 'application/json') return await c.req.json<unknown>()
    if (type === 'application/x-www-form-urlencoded') return await c.req.parseBody()
  } catch {
    return undefined
  }
}

export function success<T>(c: Context, message: T, status: 200 | 201 = 200) {
  return c.json({ status: 'success', message }, status)
}

export function failure(c: Context, message: string, status: 400 | 403 | 404 | 409 | 429 = 400) {
  return c.json({ status: 'error', message }, status)
}
