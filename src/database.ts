import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'
import { gunRecordsStubAdapter, withGunRecords } from 'prisma-gun/records'
import { PrismaClient } from './generated/prisma/client.js'
import { databaseUrl } from './config.js'
import { gunModels, gunPeer } from './gun-models.js'

export function openDatabase(url = databaseUrl) {
  if (url.startsWith('file:')) {
    return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) })
  }
  if (/^postgres(?:ql)?:/i.test(url)) {
    return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  }
  const peer = gunPeer(url)
  return withGunRecords(new PrismaClient({ adapter: gunRecordsStubAdapter }), {
    peer,
    name: 'kucos',
    models: gunModels,
  })
}
