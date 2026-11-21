import { serve } from '@hono/node-server'
import app, { config, database } from './index.js'
import { hostname, port } from './config.js'

await database.$connect()

const server = serve({ fetch: app.fetch, hostname, port }, ({ address, family, port }) => {
  const host = family === 'IPv6' ? `[${address}]` : address
  console.log(`Kucos is listening on http://${host}:${port}`)
  console.log(`Widget demo at ${config.publicUrl}/demo`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => {
      void database.$disconnect()
    })
  })
}
