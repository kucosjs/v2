import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from './generated/prisma/client.js'
import { databaseUrl } from './config.js'

export function openDatabase(url = databaseUrl) {
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) })
}
