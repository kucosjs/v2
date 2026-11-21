import { raw } from 'hono/html'
import { jsxRenderer } from 'hono/jsx-renderer'
import type { CommentWithArticle } from './comments.js'
import { safeUrl } from './http.js'
import { renderMarkdown } from './markdown.js'

type Page = { title: string; area?: 'overview' | 'spam' | 'comments' | 'demo' }
type PageRenderer = (content: string | Promise<string>, props: Page) => Response
declare module 'hono' {
  interface ContextRenderer extends PageRenderer {}
}

export const renderer = jsxRenderer(({ children, title, area }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title} · Kucos</title>
      <link rel="stylesheet" href="/admin/style.css" />
    </head>
    <body class={area === 'demo' ? 'demo-page' : undefined}>
      <header class="site-header">
        <div class="header-inner">
          <a href={area === 'demo' ? '/demo' : '/'} class="brand">
            <span aria-hidden="true">♥</span> Kucos
          </a>
          {area && area !== 'demo' ? (
            <>
              <nav aria-label="Moderation">
                <a href="/overview" aria-current={area !== 'spam' ? 'page' : undefined}>
                  Articles
                </a>
                <a href="/spam" aria-current={area === 'spam' ? 'page' : undefined}>
                  Review queue
                </a>
              </nav>
              <form action="/logout" method="post">
                <button type="submit" class="quiet">
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <a class="quiet" href={area === 'demo' ? '/' : '/demo'}>
              {area === 'demo' ? 'Moderation' : 'Widget demo'}
            </a>
          )}
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
          {error && (
            <p role="alert" class="error">
              {error}
            </p>
          )}
          <button type="submit" class="primary">
            Sign in
          </button>
        </form>
      ) : (
        <p class="notice">
          Set <code>ADMIN_PASSWORD</code> to enable moderation.
        </p>
      )}
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
        <div>
          <dt>Articles</dt>
          <dd>{articles.length}</dd>
        </div>
        <div>
          <dt>Comments</dt>
          <dd>{total}</dd>
        </div>
        <div>
          <dt>In review</dt>
          <dd>{review}</dd>
        </div>
      </dl>
      {articles.length ? (
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Article</th>
                <th scope="col">Comments</th>
                <th scope="col">In review</th>
              </tr>
            </thead>
            <tbody>
              {articles.map(({ article, total, review }) => (
                <tr>
                  <td>
                    <a href={`/comments?url=${encodeURIComponent(article)}`}>{article}</a>
                  </td>
                  <td>{total}</td>
                  <td>{review}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p class="notice">Articles appear here when they receive a comment.</p>
      )}
    </>
  )
}

const date = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})
type ViewProps = {
  comments: CommentWithArticle[]
  article?: string
  review: boolean
  page: number
  hasNext: boolean
  notice?: string
}

export function CommentList({ comments, article, review, page, hasNext, notice }: ViewProps) {
  const path = review ? '/spam' : '/comments'
  const href = (page: number) =>
    `${path}?${new URLSearchParams({ ...(article ? { url: article } : {}), page: String(page) })}`
  const articleLink = article ? safeUrl(article)?.href : undefined
  return (
    <>
      <h1>{review ? 'Review queue' : 'Article comments'}</h1>
      {articleLink && (
        <p class="article-link">
          <a href={articleLink} rel="noreferrer">
            {article}
          </a>
        </p>
      )}
      {notice && (
        <p role="status" class="notice">
          {notice}
        </p>
      )}
      {!comments.length && <p class="notice">{review ? 'The review queue is empty.' : 'No comments on this page.'}</p>}
      <div class="comment-list">
        {comments.map((comment) => (
          <article class="comment-card">
            <header>
              <strong>{comment.author}</strong>
              <time datetime={comment.createdAt.toISOString()}>{date.format(comment.createdAt)} UTC</time>
              {comment.moderation !== 'published' && (
                <span class="tag">{comment.moderation === 'spam' ? 'Spam' : 'Pending'}</span>
              )}
              {comment.pinned && <span class="tag">Pinned</span>}
            </header>
            {review && (
              <a href={`/comments?url=${encodeURIComponent(comment.article.url)}`} class="article-link">
                {comment.article.url}
              </a>
            )}
            <div class="comment-body">{raw(renderMarkdown(comment.content))}</div>
            <form action={`/moderate/${comment.id}`} method="post" class="actions">
              <input type="hidden" name="view" value={review ? 'spam' : 'comments'} />
              <input type="hidden" name="page" value={page} />
              {comment.moderation !== 'published' && (
                <button type="submit" class="primary" name="action" value="approve">
                  Approve
                </button>
              )}
              {comment.moderation !== 'spam' && (
                <button type="submit" name="action" value="spam">
                  Mark as spam
                </button>
              )}
              {comment.moderation === 'published' && (
                <button type="submit" name="action" value="pin">
                  {comment.pinned ? 'Unpin' : 'Pin'}
                </button>
              )}
              <button type="submit" name="action" value="delete" class="danger">
                Delete
              </button>
            </form>
          </article>
        ))}
      </div>
      {(page > 1 || hasNext) && (
        <nav class="pagination" aria-label="Comment pages">
          {page > 1 && <a href={href(page - 1)}>Previous page</a>}
          {hasNext && <a href={href(page + 1)}>Next page</a>}
        </nav>
      )}
    </>
  )
}

export function Demo({ publicUrl }: { publicUrl: string }) {
  return (
    <>
      <section class="demo-hero" aria-labelledby="demo-title">
        <div class="demo-intro">
          <h1 id="demo-title">Make room for discussion.</h1>
          <p>Give readers a place to reply, write in Markdown, and leave kudos on your static site.</p>
          <div class="demo-actions">
            <a class="demo-button" href="#discussion">
              Try the widget <span aria-hidden="true">↓</span>
            </a>
            <a href="#embed">Get the embed code</a>
          </div>
        </div>

        <section class="demo-preview" aria-labelledby="demo-example-title">
          <header class="demo-preview-header">
            <h2 id="demo-example-title">Example thread</h2>
            <span class="demo-kudos">
              <span aria-hidden="true">♥</span> 12 kudos
            </span>
          </header>
          <div class="demo-thread">
            <article>
              <header class="demo-comment-meta">
                <strong>Anonymous</strong> <span>20 min ago</span>
              </header>
              <p>I tried the quiet route along the river. It’s worth the extra ten minutes.</p>
              <p class="demo-comment-score">8 upvotes</p>
              <article class="demo-reply">
                <header class="demo-comment-meta">
                  <strong>Article author</strong> <span>5 min ago</span>
                </header>
                <p>
                  Good tip. I’ve added the <strong>riverside path</strong> to the guide.
                </p>
              </article>
            </article>
          </div>
        </section>
      </section>

      <section id="discussion" class="demo-section" aria-labelledby="demo-discussion-title">
        <h2 id="demo-discussion-title">Try it here</h2>
        <p class="muted">Leave a comment or give this page kudos. No account needed.</p>
        <div class="demo-widget">
          <div id="kucos-comments" data-article={`${publicUrl}/demo`}></div>
        </div>
        <script src="/min/kucos.min.js" defer></script>
      </section>

      <section id="embed" class="demo-section" aria-labelledby="demo-embed-title">
        <h2 id="demo-embed-title">Add Kucos to your site</h2>
        <p class="muted">
          Add your site to <code>ALLOWED_ORIGINS</code>, then paste this where you want comments to appear.
        </p>
        <pre class="snippet" tabindex={0}>
          <code>{`<div id="kucos-comments"></div>\n<script src="${publicUrl}/min/kucos.min.js" defer></script>`}</code>
        </pre>
      </section>
    </>
  )
}
