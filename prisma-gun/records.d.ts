import type { SqlDriverAdapterFactory } from '@prisma/driver-adapter-utils'

export const gunRecordsStubAdapter: SqlDriverAdapterFactory
export function withGunRecords<T>(prisma: T, options: { peer: string; name?: string }): T
