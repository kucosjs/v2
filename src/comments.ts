import { html } from 'hono/html'
import type { Comment } from './generated/prisma/client.js'
import { safeUrl } from './http.js'
import { renderMarkdown } from './markdown.js'

export type CommentWithArticle = Comment & { article: { url: string } }

export const EDIT_WINDOW = 60 * 60 * 1000
const MAX_THREAD_DEPTH = 32

const timestamp = new Intl.DateTimeFormat('en', {
  dateStyle: 'full', timeStyle: 'medium', timeZone: 'UTC',
})

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const units = [
  ['year', 31536000], ['month', 2592000], ['day', 86400],
  ['hour', 3600], ['minute', 60], ['second', 1],
] as const

function relativeTime(date: Date) {
  const seconds = Math.round((date.getTime() - Date.now()) / 1000)
  const [unit, duration] = units.find(([, length]) => Math.abs(seconds) >= length) ?? ['second', 1]
  return relative.format(Math.trunc(seconds / duration), unit)
}

export function canEdit(comment: Comment, owner?: string) {
  return owner === comment.owner && Date.now() - comment.createdAt.getTime() <= EDIT_WINDOW
}

type CommentWithViewerVote = Comment & { _count?: { votes: number } }

export function publicComment(comment: CommentWithViewerVote, owner?: string) {
  const hidden = comment.moderation !== 'published'
  return {
    id: comment.id,
    author: hidden ? 'Hidden' : String(html`${comment.author}`),
    authorText: hidden ? 'Hidden' : comment.author,
    comment: hidden ? 'Hidden' : renderMarkdown(comment.content),
    website: hidden || !comment.website ? null : safeUrl(comment.website)?.href ?? null,
    avatarUrl: !hidden && comment.email?.trim()
      ? `/api/comments/avatar/${encodeURIComponent(comment.id)}?v=${comment.updatedAt.getTime()}`
      : null,
    parent_id: comment.parentId,
    createdOn: comment.createdAt,
    createdOnTime: timestamp.format(comment.createdAt),
    created: relativeTime(comment.createdAt),
    updatedOn: timestamp.format(comment.updatedAt),
    edited: comment.createdAt.getTime() !== comment.updatedAt.getTime(),
    likes: comment.likes,
    dislikes: comment.dislikes,
    score: comment.likes - comment.dislikes,
    spam: Number(hidden),
    sticky: Number(!hidden && comment.pinned),
    editable: canEdit(comment, owner),
    voted: !hidden && Boolean(comment._count?.votes),
  }
}

type Thread = ReturnType<typeof publicComment> & { children: Record<string, Thread> }

export function commentThreads(comments: CommentWithViewerVote[], owner?: string) {
  const roots: Record<string, Thread> = Object.create(null)
  const nodes = new Map<string, Thread>()
  for (const comment of comments) {
    nodes.set(comment.id, { ...publicComment(comment, owner), children: Object.create(null) })
  }

  const childrenByParent = new Map<string, Thread[]>()
  const pending: Array<{ node: Thread; depth: number }> = []
  for (const node of nodes.values()) {
    if (node.parent_id && nodes.has(node.parent_id) && node.parent_id !== node.id) {
      const siblings = childrenByParent.get(node.parent_id) ?? []
      siblings.push(node)
      childrenByParent.set(node.parent_id, siblings)
    } else {
      pending.push({ node, depth: 0 })
    }
  }

  const visibleParents = new Map<string, Thread>()
  for (let index = 0; index < pending.length; index++) {
    const { node, depth } = pending[index]
    for (const child of childrenByParent.get(node.id) ?? []) {
      // Start a new visible thread when nesting would exceed the display limit.
      if (depth < MAX_THREAD_DEPTH) {
        visibleParents.set(child.id, node)
        pending.push({ node: child, depth: depth + 1 })
      } else {
        pending.push({ node: child, depth: 0 })
      }
    }
  }

  for (const node of nodes.values()) {
    const parent = visibleParents.get(node.id)
    node.parent_id = parent?.id ?? null
    if (parent) parent.children[node.id] = node
    else roots[node.id] = node
  }
  return roots
}
