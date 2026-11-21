import type { SqlDriverAdapterFactory } from '@prisma/driver-adapter-utils'

export type GunModels = Record<
  string,
  {
    key: readonly string[]
    unique?: readonly (readonly string[])[]
    defaults?: () => Record<string, unknown>
    dates?: readonly string[]
    relations?: Record<string, readonly [model: string, localField: string, foreignField: string, many?: boolean]>
    references?: readonly (readonly [model: string, localField: string, foreignField: string, optional?: boolean])[]
  }
>

export const gunRecordsStubAdapter: SqlDriverAdapterFactory
export function withGunRecords<T>(prisma: T, options: { peer: string; name?: string; models: GunModels }): T
