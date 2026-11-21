import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'
import { gunRecordsStubAdapter, withGunRecords } from 'prisma-gun/records'
import { PrismaClient } from './generated/prisma/client.js'
import { databaseUrl } from './config.js'

function gunPeer(value: string) {
  const peers = new Set(
    value.split(',').map((peer) => {
      const url = URL.parse(peer.trim())
      if (
        !url ||
        !['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) ||
        url.hash ||
        url.username ||
        url.password
      ) {
        throw new Error('DATABASE_URL must be a SQLite, PostgreSQL, or Gun relay URL.')
      }
      if (url.protocol === 'http:') url.protocol = 'ws:'
      if (url.protocol === 'https:') url.protocol = 'wss:'
      return url.href
    }),
  )
  if (peers.size !== 1)
    throw new Error(
      'Gun record storage requires one relay. HTTP and WebSocket aliases can refer to the same relay.',
    )
  return [...peers][0]
}

export function openDatabase(url = databaseUrl) {
  if (url.startsWith('file:')) {
    return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) })
  }
  if (/^postgres(?:ql)?:/i.test(url)) {
    return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  }
  const peer = gunPeer(url)
  return withGunRecords(new PrismaClient({ adapter: gunRecordsStubAdapter }), { peer })
}
