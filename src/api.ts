import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { z } from 'zod'
import type { Context } from 'hono'
import type { Akismet, SpamInput } from './akismet.js'
import { canEdit, commentThreads, EDIT_WINDOW, publicComment } from './comments.js'
import type { Config } from './config.js'
import type { PrismaClient, Moderation } from './generated/prisma/client.js'
import { articleUrl, clientIp, failure, requestBody, safeUrl, success, visitor, writeVisitor } from './http.js'

type Services = { database: PrismaClient; config: Config; akismet: Akismet }

const id = z.string().regex(/^[a-f0-9]{24}$|^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i)
const optionalText = z.string().trim().max(1000).optional()
const commentInput = z.object({
  article_url: z.string(),
  comment: z.string().trim().min(4).max(4999),
  author: optionalText,
  email: optionalText,
  website: optionalText.refine((value) => !value || !!safeUrl(value), 'Use an HTTP(S) website URL.'),
  parent_id: id.or(z.literal('')).optional(),
})
const voteInput = z.object({ msgid: id, action: z.enum(['upvote', 'downvote']) })
const kudosInput = z.object({ id: z.string(), kudo: z.enum(['add', 'remove']) })

function knownError(error: unknown, code: string) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

export function createApi({ database, config, akismet }: Services) {
  const api = new Hono()
  api.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    c.header('X-Content-Type-Options', 'nosniff')
    await next()
  })
  api.use('*', cors({
    origin: (origin) => config.allowedOrigins.has(origin) ? origin : undefined,
    allowMethods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-Kucos-Visitor'],
    credentials: true,
  }))
  api.use('*', bodyLimit({ maxSize: 64 * 1024 }))

  function allowsWrite(c: Context, article: URL) {
    const origin = c.req.header('Origin')
    return config.allowedOrigins.has(article.origin) &&
      (!origin || origin === article.origin || origin === config.publicUrl)
  }

  async function verdict(input: SpamInput): Promise<Moderation> {
    try {
      return await akismet.check(input) ? 'spam' : 'published'
    } catch {
      console.warn('Akismet check failed. The comment is pending moderation.')
      return 'pending'
    }
  }

  api.on(['POST', 'PATCH'], '/comments', async (c) => {
    const body = await requestBody(c)
    if (z.object({ username: z.string().min(1) }).safeParse(body).success) {
      return success(c, 'Comment added.', 201)
    }
    const result = commentInput.safeParse(body)
    if (!result.success) return failure(c, 'Enter a comment between 4 and 4999 characters and check the optional fields.')

    const input = result.data
    const article = articleUrl(input.article_url)
    if (!article) return failure(c, 'Invalid article URL.')
    if (!allowsWrite(c, article)) return failure(c, 'This article cannot accept comments from this origin.', 403)

    const editing = c.req.method === 'PATCH'
    const owner = writeVisitor(c, config)
    const linked = input.parent_id && await database.comment.findFirst({
      where: { id: input.parent_id, article: article.href },
    })
    if ((editing || input.parent_id) && !linked) return failure(c, 'Comment not found.', 404)

    const cutoff = new Date(Date.now() - EDIT_WINDOW)
    if (editing && linked) {
      if (linked.owner !== owner) return failure(c, 'You can only edit your own comments.', 403)
      if (linked.createdAt < cutoff) return failure(c, 'This comment can no longer be edited.', 403)
    } else if (linked && linked.moderation !== 'published') {
      return failure(c, 'Comment not found.', 404)
    }

    const previous = editing && linked ? linked : undefined
    const now = new Date()
    const data: SpamInput = {
      article: article.href,
      author: input.author === undefined ? previous?.author ?? 'Anonymous' : input.author || 'Anonymous',
      content: input.comment,
      email: input.email === undefined ? previous?.email ?? null : input.email || null,
      website: input.website === undefined ? previous?.website ?? null : input.website || null,
      ip: akismet.enabled ? clientIp(c, config.proxyHops) ?? previous?.ip ?? null : null,
      userAgent: akismet.enabled ? c.req.header('User-Agent')?.slice(0, 1024) ?? null : null,
      createdAt: previous?.createdAt ?? now,
    }
    const checked = await verdict(data)
    const moderation = previous?.moderation === 'spam' ? 'spam' : checked

    if (previous) {
      const updated = await database.comment.updateManyAndReturn({
        where: {
          id: previous.id, owner, updatedAt: previous.updatedAt, moderation: previous.moderation,
          createdAt: { gte: new Date(Date.now() - EDIT_WINDOW) },
        },
        data: {
          ...data, moderation, updatedAt: new Date(Math.max(Date.now(), previous.updatedAt.getTime() + 1)),
        },
      })
      if (!updated.length) return failure(c, 'This comment changed or can no longer be edited.', 409)
      return success(c, publicComment(updated[0], owner))
    }

    try {
      const record = await database.comment.create({
        data: { ...data, owner, parentId: linked ? linked.id : null, moderation, updatedAt: now },
      })
      return success(c, publicComment(record, owner), 201)
    } catch (error) {
      if (knownError(error, 'P2003')) return failure(c, 'Parent comment not found.', 404)
      throw error
    }
  })

  api.get('/comments/row/:id', async (c) => {
    const comment = await database.comment.findUnique({ where: { id: c.req.param('id') } })
    if (!comment || (comment.moderation !== 'published' && !canEdit(comment, visitor(c)))) {
      return failure(c, 'Comment not found.', 404)
    }
    return success(c, comment.content)
  })

  api.get('/comments/:id', async (c) => {
    const article = articleUrl(c.req.param('id'))
    if (!article) return failure(c, 'Invalid article URL.')
    const comments = await database.comment.findMany({
      where: { article: article.href },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    return c.json({ count: comments.length, comments: commentThreads(comments, visitor(c)) })
  })

  api.post('/comments/vote', async (c) => {
    const result = voteInput.safeParse(await requestBody(c))
    if (!result.success) return failure(c, 'Provide a comment ID and vote direction.')
    const { msgid, action } = result.data
    const owner = writeVisitor(c, config)

    try {
      const updated = await database.$transaction(async (tx) => {
        const comment = await tx.comment.findUnique({ where: { id: msgid } })
        if (!comment || comment.moderation !== 'published') return null
        const article = articleUrl(comment.article)
        if (!article || !allowsWrite(c, article)) return false
        await tx.vote.create({ data: { commentId: msgid, visitor: owner } })
        return tx.comment.update({
          where: { id: msgid, moderation: 'published' },
          data: action === 'upvote' ? { likes: { increment: 1 } } : { dislikes: { increment: 1 } },
          select: { likes: true, dislikes: true },
        })
      })
      if (updated === false) return failure(c, 'Voting is not allowed from this origin.', 403)
      if (!updated) return failure(c, 'Comment not found.', 404)
      return success(c, { ...updated, score: updated.likes - updated.dislikes })
    } catch (error) {
      if (knownError(error, 'P2002')) return failure(c, 'You already voted on this comment.')
      if (knownError(error, 'P2003') || knownError(error, 'P2025')) return failure(c, 'Comment not found.', 404)
      throw error
    }
  })

  api.get('/kudos/:id', async (c) => {
    const article = articleUrl(c.req.param('id'))
    if (!article) return failure(c, 'Invalid article URL.')
    const kudos = await database.kudos.findUnique({
      where: { article: article.href },
      select: { count: true, _count: { select: { members: { where: { visitor: visitor(c) ?? '' } } } } },
    })
    return success(c, { kudos: kudos?.count ?? 0, given: Boolean(kudos?._count.members) })
  })

  api.post('/kudos', async (c) => {
    const result = kudosInput.safeParse(await requestBody(c))
    if (!result.success) return failure(c, 'Provide an article URL and kudos action.')
    const url = articleUrl(result.data.id)
    if (!url) return failure(c, 'Invalid article URL.')
    if (!allowsWrite(c, url)) return failure(c, 'Kudos are not allowed from this origin.', 403)

    const article = url.href
    const owner = writeVisitor(c, config)
    const given = result.data.kudo === 'add'
    const count = await database.$transaction(async (tx) => {
      if (given) {
        const kudos = await tx.kudos.upsert({ where: { article }, update: {}, create: { article } })
        const where = { article_visitor: { article, visitor: owner } }
        if (await tx.kudosMember.findUnique({ where })) return kudos.count
        await tx.kudosMember.create({ data: { article, visitor: owner } })
        return (await tx.kudos.update({ where: { article }, data: { count: { increment: 1 } } })).count
      }

      const removed = await tx.kudosMember.deleteMany({ where: { article, visitor: owner } })
      if (removed.count) {
        return (await tx.kudos.update({ where: { article }, data: { count: { decrement: 1 } } })).count
      }
      return (await tx.kudos.findUnique({ where: { article } }))?.count ?? 0
    })
    return success(c, { kudos: count, given }, 201)
  })

  return api
}
