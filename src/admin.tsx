import { randomBytes, timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { secureHeaders } from 'hono/secure-headers'
import { z } from 'zod'
import type { Context } from 'hono'
import type { Config } from './config.js'
import type { Akismet } from './akismet.js'
import type { Comment, PrismaClient } from './generated/prisma/client.js'
import { articleUrl, clientIp, digest, failure, requestBody, success } from './http.js'
import { CommentList, Demo, Overview, SignIn, renderer } from './views.js'

const sessionCookie = 'kucos_admin'
const sessionSeconds = 8 * 60 * 60
const pageSize = 50
const notices = {
  updated: 'Comment updated.',
  removed: 'Comment deleted.',
  feedback: 'Comment updated. Akismet feedback could not be submitted.',
}

type Action = 'approve' | 'spam' | 'pin' | 'delete'

function pageNumber(value?: string) {
  const page = Number(value)
  return Number.isSafeInteger(page) && page > 0 && page <= 100000 ? page : 1
}

export function createAdmin(database: PrismaClient, config: Config, akismet: Akismet) {
  const admin = new Hono()
  const attempts = new Map<string, { count: number; until: number }>()
  const cookieOptions = { path: '/', httpOnly: true, sameSite: 'Strict' as const, secure: config.publicUrl.startsWith('https:') }
  const sessionId = (token: string) => digest(`${config.adminPassword}\n${token}`)

  admin.use('*', secureHeaders({
    referrerPolicy: 'same-origin',
    contentSecurityPolicy: { defaultSrc: ["'self'"], frameAncestors: ["'none'"], formAction: ["'self'"], baseUri: ["'none'"] },
  }))
  admin.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    const origin = c.req.header('Origin')
    const fetchSite = c.req.header('Sec-Fetch-Site')
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) &&
        (origin ? origin !== config.publicUrl : fetchSite && !['same-origin', 'none'].includes(fetchSite))) {
      return failure(c, 'Invalid request origin.', 403)
    }
    await next()
  })
  admin.use('*', bodyLimit({ maxSize: 16 * 1024 }), renderer)

  async function session(c: Context) {
    const token = getCookie(c, sessionCookie)
    if (!config.adminPassword || !token || !/^[a-f0-9]{64}$/.test(token)) return
    const id = sessionId(token)
    const active = await database.adminSession.findFirst({ where: { id, expiresAt: { gt: new Date() } } })
    return active?.id
  }

  const protect = async (c: Context, next: () => Promise<void>) => {
    if (!(await session(c))) {
      if (c.req.method === 'GET') return c.redirect('/')
      return failure(c, 'Sign in to moderate comments.', 403)
    }
    await next()
  }

  admin.get('/', async (c) => {
    if (await session(c)) return c.redirect('/overview')
    return c.render(<SignIn configured={!!config.adminPassword} />, { title: 'Sign in' })
  })
  admin.get('/demo', (c) => c.render(<Demo publicUrl={config.publicUrl} />, { title: 'Widget demo', area: 'demo' }))

  admin.post('/login', async (c) => {
    const body = z.object({ password: z.string().max(4096) }).safeParse(await requestBody(c))
    const wantsJson = c.req.header('Content-Type')?.includes('application/json')
    const reject = (message: string, status: 400 | 403 | 429) => {
      if (wantsJson) return failure(c, message, status)
      c.status(status)
      return c.render(<SignIn error={message} configured={!!config.adminPassword} />, { title: 'Sign in' })
    }
    if (!config.adminPassword) return reject('Moderation is disabled.', 403)

    const now = Date.now()
    const key = clientIp(c, config.proxyHops) ?? 'unknown'
    for (const [address, attempt] of attempts) {
      if (attempt.until <= now) attempts.delete(address)
    }
    const attempt = attempts.get(key)
    if ((attempt && attempt.count >= 10) || (!attempt && attempts.size >= 5000)) {
      c.header('Retry-After', String(Math.ceil(((attempt?.until ?? now + 60000) - now) / 1000)))
      return reject('Too many sign-in attempts. Try again later.', 429)
    }
    if (!body.success || !timingSafeEqual(Buffer.from(digest(body.data.password)), Buffer.from(digest(config.adminPassword)))) {
      attempts.set(key, { count: (attempt?.count ?? 0) + 1, until: attempt?.until ?? now + 15 * 60 * 1000 })
      return reject('Invalid password.', 400)
    }

    const token = randomBytes(32).toString('hex')
    const active = await session(c)
    await database.$transaction([
      database.adminSession.deleteMany({ where: { OR: [{ expiresAt: { lte: new Date(now) } }, ...(active ? [{ id: active }] : [])] } }),
      database.adminSession.create({ data: { id: sessionId(token), expiresAt: new Date(now + sessionSeconds * 1000) } }),
    ])
    attempts.delete(key)
    setCookie(c, sessionCookie, token, { ...cookieOptions, maxAge: sessionSeconds })
    if (wantsJson) return success(c, 'success')
    return c.redirect('/overview', 303)
  })

  admin.on(['GET', 'POST'], '/logout', async (c) => {
    const fetchSite = c.req.header('Sec-Fetch-Site')
    if (!fetchSite || fetchSite === 'same-origin' || fetchSite === 'none') {
      const id = await session(c)
      if (id) await database.adminSession.deleteMany({ where: { id } })
      deleteCookie(c, sessionCookie, cookieOptions)
    }
    return c.redirect('/', 303)
  })

  admin.get('/overview', protect, async (c) => {
    const groups = await database.comment.groupBy({ by: ['article', 'moderation'], _count: true, orderBy: { article: 'asc' } })
    const articles = new Map<string, { article: string; total: number; review: number }>()
    for (const group of groups) {
      const stats = articles.get(group.article) ?? { article: group.article, total: 0, review: 0 }
      stats.total += group._count
      if (group.moderation !== 'published') stats.review += group._count
      articles.set(group.article, stats)
    }
    return c.render(<Overview articles={[...articles.values()]} />, { title: 'Articles', area: 'overview' })
  })

  admin.get('/comments', protect, (c) => list(c, false))
  // The article query parameter identifies the comment list.
  async function list(c: Context, review: boolean) {
    const url = c.req.query('url')
    const article = url ? articleUrl(url)?.href : undefined
    if (!review && !article) return c.redirect('/overview')
    const page = pageNumber(c.req.query('page'))
    const comments = await database.comment.findMany({
      where: review ? { moderation: { not: 'published' } } : { article },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize, take: pageSize + 1,
    })
    const updated = c.req.query('updated')
    const notice = updated && Object.hasOwn(notices, updated) ? notices[updated as keyof typeof notices] : undefined
    return c.render(<CommentList comments={comments.slice(0, pageSize)} article={article} review={review}
      page={page} hasNext={comments.length > pageSize} notice={notice} />,
    { title: review ? 'Review queue' : 'Article comments', area: review ? 'spam' : 'comments' })
  }
  admin.get('/spam', protect, (c) => list(c, true))

  async function moderate(id: string | undefined, action: Action) {
    if (!id) return { comment: undefined, feedbackFailed: false }
    let changed: Comment | undefined
    let sendFeedback: 'submit-ham' | 'submit-spam' | undefined
    await database.$transaction(async (tx) => {
      const comment = await tx.comment.findUnique({ where: { id } })
      if (!comment) return
      changed = comment

      if (action === 'delete') {
        await tx.comment.delete({ where: { id } })
      } else if (action === 'pin') {
        await tx.comment.update({ where: { id }, data: { pinned: !comment.pinned } })
      } else {
        const moderation = action === 'spam' ? 'spam' : 'published'
        if (moderation === comment.moderation) return
        await tx.comment.update({ where: { id }, data: { moderation } })
        if (action === 'spam') sendFeedback = 'submit-spam'
        else if (comment.moderation === 'spam') sendFeedback = 'submit-ham'
      }
    })

    let feedbackFailed = false
    if (changed && sendFeedback && akismet.enabled && changed.ip) {
      try {
        await akismet.feedback(changed, sendFeedback)
      } catch {
        feedbackFailed = true
        console.warn('Akismet feedback failed.')
      }
    }
    return { comment: changed, feedbackFailed }
  }

  admin.post('/moderate/:id', protect, async (c) => {
    const input = z.object({
      action: z.enum(['approve', 'spam', 'pin', 'delete']), view: z.enum(['spam', 'comments']), page: z.string().optional(),
    }).safeParse(await requestBody(c))
    if (!input.success) return failure(c, 'Invalid moderation action.')
    const { action, view, page } = input.data
    const { comment, feedbackFailed } = await moderate(c.req.param('id'), action)
    if (!comment) return failure(c, 'Comment not found.', 404)
    const params = new URLSearchParams({
      ...(view === 'comments' ? { url: comment.article } : {}),
      page: String(pageNumber(page)),
      updated: feedbackFailed ? 'feedback' : action === 'delete' ? 'removed' : 'updated',
    })
    return c.redirect(`/${view}?${params}`, 303)
  })

  const legacyActions = [
    ['DELETE', '/remove/:id', 'delete'],
    ['PATCH', '/notspam/:id', 'approve'],
    ['PATCH', '/reportspam/:id', 'spam'],
    ['PATCH', '/sticky/:id', 'pin'],
  ] as const
  for (const [method, path, action] of legacyActions) {
    admin.on(method, path, protect, async (c) => {
      const { comment, feedbackFailed } = await moderate(c.req.param('id'), action)
      if (!comment) return failure(c, 'Comment not found.', 404)
      if (action === 'pin') return c.json({ message: comment.pinned ? 'unsticked' : 'sticked' })
      if (action === 'delete') return c.json({ message: 'Comment deleted' })
      return success(c, feedbackFailed ? notices.feedback : notices.updated)
    })
  }

  return admin
}
