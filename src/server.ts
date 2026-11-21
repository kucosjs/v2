import { serve } from '@hono/node-server'
import app, { database } from './index.js'
import { port } from './config.js'

const server = serve({ fetch: app.fetch, port }, ({ port }) => {
  console.log(`Kucos is listening on port ${port}.`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => {
      void database.$disconnect()
    })
  })
}
