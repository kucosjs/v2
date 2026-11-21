import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma/client.js'
import { databaseUrl } from './config.js'

import { withGun, gunStubAdapter } from "prisma-gun";

export function openDatabase(url = databaseUrl) {

  return withGun(new PrismaClient({ adapter: gunStubAdapter }), {
    peers: url.split(",").map((s) => s.trim()),
  });

  // if (url.startsWith('file:')) {
  //   return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) })
  // }

  // return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
}
