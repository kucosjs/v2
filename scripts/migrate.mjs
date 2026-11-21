import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const gunProtocols = new Set(['http:', 'https:', 'ws:', 'wss:']);
const usesGun = process.env.DATABASE_URL?.split(',').every((peer) => {
  const url = URL.parse(peer.trim());
  return url && gunProtocols.has(url.protocol);
});

if (usesGun) {
  console.log('Gun storage is initialized when Kucos connects. No SQL migrations to run.');
} else {
  const require = createRequire(import.meta.url);
  const prisma = require.resolve('prisma/build/index.js');
  const result = spawnSync(process.execPath, [prisma, 'migrate', ...process.argv.slice(2)], {
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
