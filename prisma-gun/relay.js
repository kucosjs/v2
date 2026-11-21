import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import Gun from 'gun';

const port = Number(process.env.PORT) || 8765;
const app = new Hono();

// Simple health check
app.get('/', (c) => c.text('Gun relay is running'));

// serve() returns the underlying Node HTTP server
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Gun relay listening on ws://localhost:${info.port}/gun`);
});

// Attach Gun to the server (handles WebSocket upgrades on /gun)
Gun({
  web: server,
  file: 'radata', // directory where data is persisted
});
