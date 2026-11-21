import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma/client.js'
import { databaseUrl } from './config.js'

export function openDatabase(url = databaseUrl) {
  if (url.startsWith('file:')) {
    return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) })
  }

  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
}
