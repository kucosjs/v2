import { PrismaPg } from '@prisma/adapter-pg'
import type { Hono } from 'hono'
import { createApp } from './src/app.js'
import { databaseUrl, readConfig } from './src/config.js'
import { PrismaClient } from './src/generated/prisma/client.js'

if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
  throw new Error('Set DATABASE_URL to a PostgreSQL connection URL for Vercel.')
}

const { VERCEL, VERCEL_ENV, VERCEL_URL, VERCEL_PROJECT_PRODUCTION_URL } = process.env
const hosted = VERCEL === '1' && VERCEL_ENV !== 'development'
const domain = VERCEL_ENV === 'production' ? VERCEL_PROJECT_PRODUCTION_URL || VERCEL_URL : VERCEL_URL
const config = readConfig({
  publicUrl: hosted && domain ? `https://${domain}` : undefined,
  proxyHops: hosted ? 1 : 0,
})
const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) })
const app: Hono = createApp({ database, config })

export default app
