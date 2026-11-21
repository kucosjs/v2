import { randomUUID } from 'node:crypto'
import type { GunModels } from 'prisma-gun/records'

export const gunModels = {
  Article: {
    key: ['id'],
    unique: [['url']],
    defaults: () => ({ id: randomUUID() }),
    relations: { comments: ['Comment', 'id', 'articleId', true] },
  },
  Comment: {
    key: ['id'],
    defaults: () => {
      const now = new Date().toISOString()
      return {
        id: randomUUID(),
        author: 'Anonymous',
        email: null,
        website: null,
        parentId: null,
        moderation: 'published',
        pinned: false,
        likes: 0,
        dislikes: 0,
        createdAt: now,
        updatedAt: now,
        ip: null,
        userAgent: null,
      }
    },
    dates: ['createdAt', 'updatedAt'],
    relations: {
      article: ['Article', 'articleId', 'id'],
      votes: ['Vote', 'id', 'commentId', true],
    },
    references: [
      ['Article', 'articleId', 'id'],
      ['Comment', 'parentId', 'id', true],
    ],
  },
  Vote: {
    key: ['commentId', 'visitor'],
    references: [['Comment', 'commentId', 'id']],
  },
  Kudos: {
    key: ['articleId'],
    defaults: () => ({ count: 0 }),
    relations: {
      article: ['Article', 'articleId', 'id'],
      members: ['KudosMember', 'articleId', 'articleId', true],
    },
    references: [['Article', 'articleId', 'id']],
  },
  KudosMember: {
    key: ['articleId', 'visitor'],
    references: [['Kudos', 'articleId', 'articleId']],
  },
} satisfies GunModels

export function gunPeer(value: string) {
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
