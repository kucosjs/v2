import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import Gun from 'gun';

const port = Number(process.env.GUN_PORT ?? process.env.PORT ?? 8765);
const hostname = process.env.GUN_HOST || '127.0.0.1';
const app = new Hono();

// Simple health check
app.get('/', (c) => c.text('Gun relay is running'));

// serve() returns the underlying Node HTTP server
const server = serve({ fetch: app.fetch, hostname, port }, (info) => {
  const address = info.family === 'IPv6' ? `[${info.address}]` : info.address;
  console.log(`Gun relay listening on ws://${address}:${info.port}/gun`);
});

// Attach Gun to the server (handles WebSocket upgrades on /gun)
Gun({
  web: server,
  file: process.env.GUN_DATA_DIR || 'radata',
  axe: false,
  multicast: false,
  stats: false,
});
