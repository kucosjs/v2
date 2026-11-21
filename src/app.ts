import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { createAdmin } from './admin.js'
import { createApi } from './api.js'
import { createAkismet } from './akismet.js'
import type { Akismet } from './akismet.js'
import type { Config } from './config.js'
import type { PrismaClient } from './generated/prisma/client.js'

const publicRoot = fileURLToPath(new URL('../public/', import.meta.url))
const widgetRoot = fileURLToPath(new URL('./widget/', import.meta.url))
const assets = [
  { route: '/embed/kucos.js', source: 'embed/kucos.js' },
  { route: '/embed/kucos.css', source: 'embed/kucos.css' },
  { route: '/min/kucos.min.js', source: 'embed/kucos.js', built: 'kucos.min.js' },
  { route: '/min/kucos.min.css', source: 'embed/kucos.css', built: 'kucos.min.css' },
  { route: '/admin/style.css', source: 'admin/style.css' },
]

export function createApp({
  database,
  config,
  akismet = createAkismet(config),
}: {
  database: PrismaClient
  config: Config
  akismet?: Akismet
}) {
  const app = new Hono({ strict: false })
  app.onError((error, c) => {
    console.error('Kucos request failed.', error.name, 'code' in error ? error.code : '')
    return c.json({ status: 'error', message: 'Something went wrong.' }, 500)
  })
  app.notFound((c) => c.json({ status: 'error', message: 'Page not found.' }, 404))

  for (const { route, source, built } of assets) {
    const asset =
      built && existsSync(join(widgetRoot, built))
        ? { root: widgetRoot, path: built }
        : { root: publicRoot, path: source }
    app.get(
      route,
      async (c, next) => {
        c.header('X-Content-Type-Options', 'nosniff')
        c.header('Cross-Origin-Resource-Policy', 'cross-origin')
        c.header('Cache-Control', asset.root === widgetRoot ? 'public, max-age=300' : 'no-cache')
        await next()
      },
      serveStatic(asset),
    )
  }

  app.route('/api', createApi({ database, config, akismet }))
  app.route('/', createAdmin(database, config, akismet))
  return app
}
