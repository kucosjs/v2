import 'dotenv/config'

export const hostname = process.env.HOST?.trim() || undefined
export const port = readInteger(process.env.PORT ?? '3000', 'PORT', 1, 65535)
export const databaseUrl = process.env.DATABASE_URL || 'file:./data/kucos.sqlite'

function readInteger(value: string, name: string, minimum: number, maximum: number) {
  const parsed = Number(value)
  if (!/^\d+$/.test(value) || !Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`)
  }
  return parsed
}

function origin(value: string) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.href !== `${url.origin}/`) {
    throw new Error('Site URLs must be HTTP(S) origins without a path, query, or credentials.')
  }
  return url.origin
}

export function webUrl(input) {
  if (typeof input !== 'string' || input.length > 2000 || !URL.canParse(input)) return undefined;
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
  return url;
}

export function readConfig() {
  const publicUrl = origin(process.env.PUBLIC_URL || `http://localhost:${port}`)
  const allowedOrigins = new Set([
    publicUrl,
    ...(process.env.ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean).map(origin),
  ])

  return {
    publicUrl,
    allowedOrigins,
    adminPassword: process.env.ADMIN_PASSWORD || undefined,
    akismetKey: process.env.AKISMET_API_KEY || undefined,
    akismetTesting: process.env.AKISMET_TESTING === 'true',
    proxyHops: readInteger(process.env.TRUST_PROXY_HOPS ?? '0', 'TRUST_PROXY_HOPS', 0, 100),
  }
}

export type Config = ReturnType<typeof readConfig>
