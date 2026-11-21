import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { decode } from 'he'
import { openDatabase } from '../src/database.js'
import type { Prisma } from '../src/generated/prisma/client.js'
import { articleUrl, digest, safeUrl } from '../src/http.js'

type Row = Record<string, unknown>
type Comment = Prisma.CommentCreateManyInput

function record(value: unknown): Row {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Row
  throw new Error('Expected a MongoDB document.')
}

async function rows(directory: string, collection: string): Promise<Row[]> {
  let source: string
  try {
    source = (await readFile(join(directory, `${collection}.json`), 'utf8')).trim()
  } catch (error) {
    if (collection !== 'comments' && error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
    throw new Error(`Could not read ${collection}.json.`)
  }

  try {
    if (!source) return []
    const data: unknown[] = source.startsWith('[')
      ? JSON.parse(source)
      : source
          .split(/\r?\n/)
          .filter((line) => line.trim())
          .map((line) => JSON.parse(line))
    return data.map(record)
  } catch {
    throw new Error(`Invalid MongoDB JSON in ${collection}.json.`)
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function objectId(value: unknown): string {
  const id = typeof value === 'string' ? value : value ? text(record(value).$oid) : ''
  return /^[a-f0-9]{24}$/i.test(id) ? id.toLowerCase() : ''
}

function integer(value: unknown): number {
  const data = value && typeof value === 'object' ? record(value) : null
  const number = Number(data ? (data.$numberInt ?? data.$numberLong ?? data.$numberDouble) : (value ?? 0))
  if (!Number.isInteger(number) || number > 2147483647 || number < -2147483648) {
    throw new Error('A MongoDB counter is outside the supported range.')
  }
  return number
}

function date(value: unknown): Date | undefined {
  if (!value) return
  const raw = typeof value === 'object' ? record(value).$date : value
  const result = new Date(raw && typeof raw === 'object' ? Number(record(raw).$numberLong) : String(raw))
  if (Number.isNaN(result.getTime())) throw new Error('Invalid timestamp in MongoDB export.')
  return result
}

function article(value: unknown): string {
  const url = articleUrl(text(value))
  if (!url) throw new Error('Invalid article URL in MongoDB export.')
  return url.href
}

function owner(value: unknown) {
  return digest(text(value).toLowerCase())
}

async function importLegacy(directory: string) {
  const [comments, votes, spams, kudos] = await Promise.all(
    ['comments', 'votes', 'spams', 'kudos'].map((collection) => rows(directory, collection)),
  )
  const spamIds = new Set(spams.map((row) => objectId(row.comment_id)))
  const articles = new Map<string, string>()
  function articleId(value: unknown) {
    const url = article(value)
    const known = articles.get(url)
    if (known) return known
    const id = randomUUID()
    articles.set(url, id)
    return id
  }

  const byId = new Map<string, Comment>()
  const parents = new Map<string, string>()
  for (const row of comments) {
    const id = objectId(row._id)
    if (!id || byId.has(id)) throw new Error('Invalid or duplicate comment ID in MongoDB export.')
    const website = safeUrl(decode(text(row.website)))?.href
    const createdAt = date(row.createdOn) ?? new Date(0)
    byId.set(id, {
      id,
      articleId: articleId(row.article_id),
      content: text(row.comment),
      author: decode(text(row.author)) || 'Anonymous',
      email: decode(text(row.email)) || null,
      website,
      owner: owner(row.userid),
      likes: Math.max(0, integer(row.likes)),
      dislikes: Math.max(0, integer(row.dislikes)),
      moderation: spamIds.has(id) || integer(row.spam) ? 'spam' : 'published',
      pinned: integer(row.sticky) === 1,
      createdAt,
      updatedAt: date(row.updatedOn) ?? createdAt,
    })
    const parent = objectId(row.parent_id)
    if (parent) parents.set(id, parent)
  }

  for (const [child, parent] of parents) {
    if (!byId.has(parent) || byId.get(child)?.articleId !== byId.get(parent)?.articleId) {
      parents.delete(child)
    }
  }
  const visited = new Set<string>()
  for (const child of parents.keys()) {
    const path = new Set<string>()
    let next: string | undefined = child
    while (next && !visited.has(next)) {
      if (path.has(next)) {
        parents.delete(next)
        break
      }
      path.add(next)
      next = parents.get(next)
    }
    for (const id of path) visited.add(id)
  }

  const uniqueVotes = new Map<string, Prisma.VoteCreateManyInput>()
  for (const row of votes) {
    const commentId = objectId(row.msgid)
    if (!byId.has(commentId) || !text(row.userid)) continue
    const visitor = owner(row.userid)
    uniqueVotes.set(`${commentId}:${visitor}`, { commentId, visitor })
  }
  const counts = new Map<string, number>()
  for (const row of kudos) {
    const id = articleId(row.article_id)
    counts.set(id, integer((counts.get(id) ?? 0) + Math.max(0, integer(row.kudos))))
  }

  const database = openDatabase()
  try {
    await database.$transaction(
      async (tx) => {
        if (await tx.article.count()) throw new Error('The destination database already contains articles.')
        await tx.article.createMany({ data: [...articles].map(([url, id]) => ({ id, url })) })
        await tx.comment.createMany({ data: [...byId.values()] })
        for (const [id, parentId] of parents) await tx.comment.update({ where: { id }, data: { parentId } })
        await tx.vote.createMany({ data: [...uniqueVotes.values()] })
        await tx.kudos.createMany({
          data: [...counts].map(([articleId, count]) => ({ articleId, count })),
        })
      },
      { timeout: 120000 },
    )
    console.log(
      `Imported ${byId.size} comments, ${uniqueVotes.size} vote records, and kudos totals for ${counts.size} articles.`,
    )
  } finally {
    await database.$disconnect()
  }
}

const directory = process.argv[2]
try {
  if (!directory) throw new Error('Usage: npm run db:import -- <mongo-export-directory>')
  await importLegacy(directory)
} catch (error) {
  console.error(error instanceof Error && error.name === 'Error' ? error.message : 'MongoDB import failed.')
  process.exitCode = 1
}
