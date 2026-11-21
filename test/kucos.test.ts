import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { createApp } from '../src/app.js'
import { openDatabase } from '../src/database.js'
import { commentThreads } from '../src/comments.js'
import { renderMarkdown } from '../src/markdown.js'
import type { Comment } from '../src/generated/prisma/client.js'

const migrations = new URL('../prisma/migrations/', import.meta.url)
const directory = mkdtempSync(join(tmpdir(), 'kucos-test-'))
const filename = join(directory, 'test.db')
const database = openDatabase(`file:${filename}`)
const article = 'https://site.example/notes/100%25?next=%2F'
const site = new URL(article).origin
const visitor = randomUUID()
const otherVisitor = randomUUID()
const feedback: string[] = []
const config = {
  publicUrl: 'http://localhost:3000',
  allowedOrigins: new Set(['http://localhost:3000', site]),
  adminPassword: 'test-password',
  akismetKey: undefined,
  akismetTesting: false,
  proxyHops: 1,
}
const app = createApp({
  database,
  config,
  akismet: {
    enabled: true,
    check: async ({ content }) => {
      if (content.includes('Unavailable')) throw new Error('Akismet unavailable')
      return content.includes('Likely spam')
    },
    feedback: async (_content, decision) => { feedback.push(decision) },
  },
})

before(() => {
  const sqlite = new DatabaseSync(filename)
  const directories = readdirSync(migrations, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  for (const directory of directories) {
    sqlite.exec(readFileSync(new URL(`${directory}/migration.sql`, migrations), 'utf8'))
  }
  sqlite.close()
})
after(async () => {
  await database.$disconnect()
  rmSync(directory, { recursive: true, force: true })
})

function write(path: string, body: object, user = visitor, method = 'POST', origin = site) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Kucos-Visitor': user, Origin: origin, 'X-Forwarded-For': '192.0.2.1' },
    body: JSON.stringify(body),
  })
}

test('threads replies, validates edits and keeps email and unsafe markup out of public results', async () => {
  const posted = await write('/api/comments', {
    article_url: `${article}#comment-old`,
    comment: '**Hello** <script>ignored</script> [unsafe](javascript:alert(1))',
    author: '<b>Author</b>',
    email: 'author@example.test',
  })
  assert.equal(posted.status, 201)
  const { message: comment } = await posted.json()
  assert.match(comment.comment, /<strong>Hello<\/strong>/)
  assert.doesNotMatch(comment.comment, /<script>|href="javascript:/)
  assert.equal(comment.email, undefined)
  const draftPath = `/api/comments/edit/${comment.id}`
  const ownerHeaders = { 'X-Kucos-Visitor': visitor }
  assert.equal((await app.request(draftPath, { headers: { 'X-Kucos-Visitor': otherVisitor } })).status, 404)
  const draft = await app.request(draftPath, { headers: ownerHeaders })
  assert.equal(draft.status, 200)
  assert.equal((await draft.json()).message.email, 'author@example.test')

  const replied = await write('/api/comments', {
    article_url: article, comment: 'A reply', parent_id: comment.id,
  }, otherVisitor)
  assert.equal(replied.status, 201)
  const { message: reply } = await replied.json()
  const path = `/api/comments/${encodeURIComponent(article)}`
  const response = await app.request(path)
  assert.equal(response.status, 200)
  const thread = await response.json()
  assert.equal(thread.comments[comment.id].children[reply.id].id, reply.id)
  assert.equal(thread.count, 2)
  assert.equal((await write('/api/comments', {
    article_url: article, comment: 'Trying to edit', parent_id: comment.id,
  }, otherVisitor, 'PATCH')).status, 403)
  assert.equal((await write('/api/comments', {
    article_url: article, comment: 'Updated text', parent_id: comment.id,
  }, visitor, 'PATCH')).status, 200)
  await database.comment.update({ where: { id: comment.id }, data: { createdAt: new Date(0) } })
  assert.equal((await app.request(draftPath, { headers: ownerHeaders })).status, 404)
  assert.equal((await write('/api/comments', {
    article_url: article, comment: 'Trying after expiry', parent_id: comment.id,
  }, visitor, 'PATCH')).status, 403)

  const vote = { msgid: comment.id, action: 'upvote' }
  const responses = await Promise.all([write('/api/comments/vote', vote, otherVisitor), write('/api/comments/vote', vote, otherVisitor)])
  assert.deepEqual(responses.map(({ status }) => status).sort(), [200, 400])
  assert.equal((await database.comment.findUniqueOrThrow({ where: { id: comment.id } })).likes, 1)
  const voterThread = await app.request(path, { headers: { 'X-Kucos-Visitor': otherVisitor } })
  assert.equal((await voterThread.json()).comments[comment.id].voted, true)
  const authorThread = await app.request(path, { headers: ownerHeaders })
  assert.equal((await authorThread.json()).comments[comment.id].voted, false)
})

test('serves Gravatars for published comments without publishing email identifiers', async (context) => {
  const email = 'avatar@example.test'
  const hash = createHash('sha256').update(email).digest('hex')
  const image = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
  let available = true
  const fetchAvatar = context.mock.method(globalThis, 'fetch', async () => available
    ? new Response(image, { headers: { 'Content-Type': 'image/gif' } })
    : new Response(null, { status: 404 }))
  const articleUrl = `${site}/avatar-test`
  const posted = await write('/api/comments', {
    article_url: articleUrl, comment: 'A comment with an avatar', email: ` ${email.toUpperCase()} `,
  })
  assert.equal(posted.status, 201)
  const { message: comment } = await posted.json()
  assert.equal(comment.email, undefined)
  assert.ok(comment.avatarUrl.startsWith(`/api/comments/avatar/${comment.id}?v=`))
  const publicThread = await app.request(`/api/comments/${encodeURIComponent(articleUrl)}`)
  const thread = await publicThread.text()
  assert.ok(thread.includes(comment.avatarUrl))
  assert.ok(!thread.includes(hash))
  assert.ok(!thread.toLowerCase().includes(email))

  const avatar = await app.request(comment.avatarUrl)
  assert.equal(avatar.status, 200)
  assert.equal(avatar.headers.get('Content-Type'), 'image/gif')
  assert.equal(avatar.headers.get('Cross-Origin-Resource-Policy'), 'cross-origin')
  assert.deepEqual(Buffer.from(await avatar.arrayBuffer()), image)
  assert.equal(fetchAvatar.mock.calls[0].arguments[0], `https://0.gravatar.com/avatar/${hash}?s=80&d=404&r=g`)

  available = false
  assert.equal((await app.request(comment.avatarUrl)).status, 404)
  const edited = await write('/api/comments', {
    article_url: articleUrl, comment: 'An edited avatar comment', parent_id: comment.id, email: 'another@example.test',
  }, visitor, 'PATCH')
  assert.equal(edited.status, 200)
  assert.notEqual((await edited.json()).message.avatarUrl, comment.avatarUrl)

  const flagged = await write('/api/comments', { article_url: articleUrl, comment: 'Likely spam', email })
  const { message: hidden } = await flagged.json()
  assert.equal(hidden.avatarUrl, null)
  assert.equal((await app.request(`/api/comments/avatar/${hidden.id}`)).status, 404)
  assert.equal(fetchAvatar.mock.callCount(), 2)
})

test('Marked preserves legacy spoilers, inline quotes and links', () => {
  const html = renderMarkdown('!**hidden**\n! next line\n\nA :"quote": and [relative link](/guide).')
  assert.match(html, /<details[^>]*>.*<strong>hidden<\/strong>/s)
  assert.match(html, /<br>\s*next line/)
  assert.match(html, /<q>quote<\/q>/)
  assert.match(html, /href="\/guide"/)
  assert.doesNotMatch(renderMarkdown('![remote](https://example.test/image.png)'), /<img/)
})

test('counting and removing kudos is idempotent per visitor', async () => {
  const add = { id: article, kudo: 'add' }
  const remove = { id: article, kudo: 'remove' }
  const added = await Promise.all([write('/api/kudos', add), write('/api/kudos', add)])
  for (const response of added) {
    assert.equal(response.status, 201)
    assert.deepEqual((await response.json()).message, { kudos: 1, given: true })
  }
  const path = `/api/kudos/${encodeURIComponent(article)}`
  assert.equal((await (await app.request(path)).json()).message.kudos, 1)
  await write('/api/kudos', remove, otherVisitor)
  assert.equal((await (await app.request(path)).json()).message.kudos, 1)
  await Promise.all([write('/api/kudos', remove), write('/api/kudos', remove)])
  assert.equal((await (await app.request(path)).json()).message.kudos, 0)
})

test('an article URL change keeps its comments and kudos together', async () => {
  const original = `${site}/original`
  const moved = `${site}/moved`
  const posted = await write('/api/comments', { article_url: original, comment: 'An existing comment' })
  assert.equal(posted.status, 201)
  const { message: comment } = await posted.json()
  const reply = await write('/api/comments', { article_url: original, comment: 'An existing reply', parent_id: comment.id })
  assert.equal(reply.status, 201)
  const { message: child } = await reply.json()
  const vote = { msgid: comment.id, action: 'upvote' }
  assert.equal((await write('/api/comments/vote', vote, otherVisitor)).status, 200)
  assert.equal((await write('/api/kudos', { id: original, kudo: 'add' })).status, 201)

  const stored = await database.article.findUniqueOrThrow({ where: { url: original } })
  const updated = await database.article.update({ where: { id: stored.id }, data: { url: moved } })
  assert.equal(updated.id, stored.id)

  const comments = await app.request(`/api/comments/${encodeURIComponent(moved)}`)
  const thread = (await comments.json()).comments[comment.id]
  assert.equal(thread.children[child.id].id, child.id)
  assert.equal(thread.score, 1)
  assert.equal((await write('/api/comments/vote', vote, otherVisitor)).status, 400)
  const kudos = await app.request(`/api/kudos/${encodeURIComponent(moved)}`, {
    headers: { 'X-Kucos-Visitor': visitor },
  })
  assert.deepEqual((await kudos.json()).message, { kudos: 1, given: true })
  const oldThread = await app.request(`/api/comments/${encodeURIComponent(original)}`)
  assert.equal((await oldThread.json()).count, 0)
})

test('holds spam and check failures, supports moderation and revokes admin sessions', async () => {
  const spam = await write('/api/comments', { article_url: article, comment: 'Likely spam' })
  const pending = await write('/api/comments', { article_url: article, comment: 'Unavailable' })
  const { message: comment } = await spam.json()
  const { message: pendingComment } = await pending.json()
  assert.equal(comment.spam, 1)
  assert.equal(pendingComment.spam, 1)
  assert.equal((await app.request(`/api/comments/row/${comment.id}`)).status, 404)
  const pendingSource = `/api/comments/row/${pendingComment.id}`
  const headers = { 'X-Kucos-Visitor': visitor }
  assert.equal((await app.request(pendingSource, { headers })).status, 200)
  await database.comment.update({ where: { id: pendingComment.id }, data: { createdAt: new Date(0) } })
  assert.equal((await app.request(pendingSource, { headers })).status, 404)
  assert.equal((await app.request('/overview')).status, 302)
  assert.equal((await app.request('/')).headers.get('Referrer-Policy'), 'same-origin')
  const login = await app.request('/login', {
    method: 'POST', headers: { Origin: 'http://localhost:3000' }, body: new URLSearchParams({ password: 'test-password' }),
  })
  assert.equal(login.status, 303)
  const setCookie = login.headers.get('Set-Cookie')
  assert.ok(setCookie)
  const cookie = setCookie.split(';')[0]
  const overview = await app.request('/overview', { headers: { cookie } })
  assert.equal(overview.status, 200)
  assert.ok((await overview.text()).includes(`/comments?url=${encodeURIComponent(article)}`))
  const dashboard = await app.request('/spam', { headers: { cookie } })
  assert.equal(dashboard.status, 200)
  assert.match(await dashboard.text(), /Likely spam/)
  assert.equal((await app.request(`/notspam/${comment.id}`, {
    method: 'PATCH', headers: { cookie, origin: 'https://other.example' },
  })).status, 403)
  assert.equal((await app.request(`/notspam/${comment.id}`, { method: 'PATCH', headers: { cookie } })).status, 200)
  assert.deepEqual(feedback, ['submit-ham'])
  assert.equal((await app.request(`/api/comments/row/${comment.id}`)).status, 200)
  assert.equal((await app.request('/logout', { method: 'POST', headers: { cookie } })).status, 303)
  assert.equal((await app.request('/spam', { headers: { cookie } })).status, 302)
})

test('admin sessions expire after eight hours and are scoped to the running app', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  const running = createApp({ database, config })
  const login = await running.request('/login', {
    method: 'POST', body: new URLSearchParams({ password: config.adminPassword }),
  })
  assert.equal(login.status, 303)
  const setCookie = login.headers.get('Set-Cookie')
  assert.ok(setCookie)
  const cookie = setCookie.split(';')[0]
  const headers = { cookie }
  assert.equal((await running.request('/overview', { headers })).status, 200)

  const restarted = createApp({ database, config })
  assert.equal((await restarted.request('/overview', { headers })).status, 302)

  context.mock.timers.tick(8 * 60 * 60 * 1000 - 1)
  assert.equal((await running.request('/overview', { headers })).status, 200)
  context.mock.timers.tick(1)
  assert.equal((await running.request('/overview', { headers })).status, 302)
})

test('only registered origins may preflight and post to their own articles', async () => {
  const preflight = await app.request('/api/comments', {
    method: 'OPTIONS', headers: { Origin: site, 'Access-Control-Request-Method': 'POST' },
  })
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), site)
  const other = await write('/api/comments', { article_url: article, comment: 'Rejected' }, visitor, 'POST', 'https://other.example')
  assert.equal(other.status, 403)
  assert.equal(other.headers.get('Access-Control-Allow-Origin'), null)
})

test('the public API limits reads and writes separately for each client IP', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  const limited = createApp({ database, config })
  const headers = { 'Content-Type': 'application/json', 'X-Forwarded-For': '192.0.2.10', Origin: site }
  const write = (requestHeaders = headers) => limited.request('/api/comments', {
    method: 'POST', headers: requestHeaders, body: '{}',
  })

  for (let index = 0; index < 90; index++) assert.equal((await write()).status, 400)
  const denied = await write()
  assert.equal(denied.status, 429)
  assert.match(denied.headers.get('Retry-After') ?? '', /^(?:[1-9]|[1-5][0-9]|60)$/)
  assert.equal(denied.headers.get('Access-Control-Allow-Origin'), site)
  assert.match(denied.headers.get('Access-Control-Expose-Headers') ?? '', /Retry-After/i)
  assert.equal((await limited.request('/api/kudos', { method: 'POST', headers, body: '{}' })).status, 429)
  assert.equal((await write({ ...headers, 'X-Forwarded-For': '192.0.2.11' })).status, 400)

  for (let index = 0; index < 360; index++) {
    assert.equal((await limited.request('/api/comments/invalid-url', { headers })).status, 400)
  }
  assert.equal((await limited.request('/api/comments/invalid-url', { headers })).status, 429)
  const preflight = await limited.request('/api/comments', {
    method: 'OPTIONS', headers: { ...headers, 'Access-Control-Request-Method': 'POST' },
  })
  assert.equal(preflight.status, 204)

  context.mock.timers.tick(60_000)
  assert.equal((await write()).status, 400)
})

test('public API limits use the socket IP when no proxy is trusted', async () => {
  const limited = createApp({ database, config: { ...config, proxyHops: 0 } })
  const write = (remoteAddress: string, forwardedFor: string) => limited.request('/api/kudos', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': forwardedFor }, body: '{}',
  }, { incoming: { socket: { remoteAddress } } })

  for (let index = 0; index < 90; index++) {
    assert.equal((await write('192.0.2.12', '192.0.2.13')).status, 400)
  }
  assert.equal((await write('192.0.2.12', '192.0.2.14')).status, 429)
  assert.equal((await write('192.0.2.15', '192.0.2.13')).status, 400)
})

test('keeps very deep threads serializable without losing replies', () => {
  const now = new Date()
  const sample: Comment = {
    id: '', articleId: '', author: 'Anonymous', content: 'A reply',
    email: null, website: null, owner: visitor, parentId: null,
    moderation: 'published', pinned: false, likes: 0, dislikes: 0,
    createdAt: now, updatedAt: now, ip: null, userAgent: null,
  }
  const comments = Array.from({ length: 5000 }, (_, index) => ({
    ...sample,
    id: String(index),
    parentId: index ? String(index - 1) : null,
  }))
  const roots = commentThreads(comments)
  const payload = JSON.stringify(roots)
  assert.equal(payload.match(/"id":/g)?.length, comments.length)
})
