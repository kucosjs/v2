import { jsxRenderer } from 'hono/jsx-renderer'
import { raw } from 'hono/html'
import type { CommentWithArticle } from './comments.js'
import { safeUrl } from './http.js'
import { renderMarkdown } from './markdown.js'

type Page = { title: string; area?: 'overview' | 'spam' | 'comments' | 'demo' }
declare module 'hono' {
  interface ContextRenderer {
    (content: string | Promise<string>, props: Page): Response
  }
}

export const renderer = jsxRenderer(({ children, title, area }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title} · Kucos</title>
      <link rel="stylesheet" href="/admin/style.css" />
    </head>
    <body>
      <header class="site-header">
        <div class="header-inner">
          <a href="/" class="brand"><span aria-hidden="true">♥</span> Kucos</a>
          {area && area !== 'demo' ? (
            <>
              <nav aria-label="Moderation">
                <a href="/overview" aria-current={area !== 'spam' ? 'page' : undefined}>Articles</a>
                <a href="/spam" aria-current={area === 'spam' ? 'page' : undefined}>Review queue</a>
              </nav>
              <form action="/logout" method="post">
                <button type="submit" class="quiet">Sign out</button>
              </form>
            </>
          ) : <a class="quiet" href={area === 'demo' ? '/' : '/demo'}>{area === 'demo' ? 'Moderation' : 'Widget demo'}</a>}
        </div>
      </header>
      <main class={area ? 'main' : 'main sign-in'}>{children}</main>
    </body>
  </html>
))

export function SignIn({ error, configured }: { error?: string; configured: boolean }) {
  return (
    <section class="login-card">
      <h1>Moderation sign-in</h1>
      <p class="muted">Manage comments across the sites that use Kucos.</p>
      {configured ? (
        <form action="/login" method="post">
          <label for="password">Admin password</label>
          <input type="password" id="password" name="password" autocomplete="current-password" required />
          {error && <p role="alert" class="error">{error}</p>}
          <button type="submit" class="primary">Sign in</button>
        </form>
      ) : <p class="notice">Set <code>ADMIN_PASSWORD</code> to enable moderation.</p>}
    </section>
  )
}

type ArticleStats = { article: string; total: number; review: number }
export function Overview({ articles }: { articles: ArticleStats[] }) {
  const total = articles.reduce((sum, article) => sum + article.total, 0)
  const review = articles.reduce((sum, article) => sum + article.review, 0)
  return (
    <>
      <h1>Articles</h1>
      <dl class="stats">
        <div><dt>Articles</dt><dd>{articles.length}</dd></div>
        <div><dt>Comments</dt><dd>{total}</dd></div>
        <div><dt>In review</dt><dd>{review}</dd></div>
      </dl>
      {articles.length ? <div class="table-wrap">
        <table>
          <thead><tr><th scope="col">Article</th><th scope="col">Comments</th><th scope="col">In review</th></tr></thead>
          <tbody>{articles.map(({ article, total, review }) => (
            <tr>
              <td><a href={`/comments?url=${encodeURIComponent(article)}`}>{article}</a></td>
              <td>{total}</td>
              <td>{review}</td>
            </tr>
          ))}</tbody>
        </table>
      </div> : <p class="notice">Articles appear here when they receive a comment.</p>}
    </>
  )
}

const date = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })
type ViewProps = { comments: CommentWithArticle[]; article?: string; review: boolean; page: number; hasNext: boolean; notice?: string }

export function CommentList({ comments, article, review, page, hasNext, notice }: ViewProps) {
  const path = review ? '/spam' : '/comments'
  const href = (page: number) => `${path}?${new URLSearchParams({ ...(article ? { url: article } : {}), page: String(page) })}`
  const articleLink = article ? safeUrl(article)?.href : undefined
  return (
    <>
      <h1>{review ? 'Review queue' : 'Article comments'}</h1>
      {articleLink && <p class="article-link"><a href={articleLink} rel="noreferrer">{article}</a></p>}
      {notice && <p role="status" class="notice">{notice}</p>}
      {!comments.length && <p class="notice">{review ? 'The review queue is empty.' : 'No comments on this page.'}</p>}
      <div class="comment-list">{comments.map((comment) => (
        <article class="comment-card">
          <header>
            <strong>{comment.author}</strong>
            <time datetime={comment.createdAt.toISOString()}>{date.format(comment.createdAt)} UTC</time>
            {comment.moderation !== 'published' && <span class="tag">{comment.moderation === 'spam' ? 'Spam' : 'Pending'}</span>}
            {comment.pinned && <span class="tag">Pinned</span>}
          </header>
          {review && <a href={`/comments?url=${encodeURIComponent(comment.article.url)}`} class="article-link">{comment.article.url}</a>}
          <div class="comment-body">{raw(renderMarkdown(comment.content))}</div>
          <form action={`/moderate/${comment.id}`} method="post" class="actions">
            <input type="hidden" name="view" value={review ? 'spam' : 'comments'} />
            <input type="hidden" name="page" value={page} />
            {comment.moderation !== 'published' && <button type="submit" class="primary" name="action" value="approve">Approve</button>}
            {comment.moderation !== 'spam' && <button type="submit" name="action" value="spam">Mark as spam</button>}
            {comment.moderation === 'published' && <button type="submit" name="action" value="pin">{comment.pinned ? 'Unpin' : 'Pin'}</button>}
            <button type="submit" name="action" value="delete" class="danger">Delete</button>
          </form>
        </article>
      ))}</div>
      {(page > 1 || hasNext) && <nav class="pagination" aria-label="Comment pages">
        {page > 1 && <a href={href(page - 1)}>Previous page</a>}
        {hasNext && <a href={href(page + 1)}>Next page</a>}
      </nav>}
    </>
  )
}

export function Demo({ publicUrl }: { publicUrl: string }) {
  return (
    <>
      <h1>Comments and kudos for static sites</h1>
      <p class="muted">Add the Kucos widget to any page on a registered site.</p>
      <pre class="snippet"><code>{`<div id="kucos-comments"></div>\n<script src="${publicUrl}/min/kucos.min.js" defer></script>`}</code></pre>
      <div id="kucos-comments"></div>
      <script src="/min/kucos.min.js" defer></script>
    </>
  )
}
