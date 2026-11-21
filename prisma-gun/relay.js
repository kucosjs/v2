import { createServer } from 'node:http';
import Gun from 'gun';

const port = Number(process.env.GUN_PORT ?? process.env.PORT ?? 8765);
const hostname = process.env.GUN_HOST || '127.0.0.1';
const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/') {
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Gun relay is running');
  } else {
    response.writeHead(404).end();
  }
});

// Attach Gun to the server (handles WebSocket upgrades on /gun)
Gun({
  web: server,
  file: process.env.GUN_DATA_DIR || 'radata',
  axe: false,
  multicast: false,
  stats: false,
});

server.listen({ host: hostname, port }, () => {
  const info = server.address();
  const address = info.family === 'IPv6' ? `[${info.address}]` : info.address;
  console.log(`Gun relay listening on ws://${address}:${info.port}/gun`);
});
