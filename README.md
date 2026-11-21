# Kucos

Kucos adds anonymous comments and kudos to static websites. The Node.js server runs on Hono, stores data in SQLite through Prisma, and can send comments to Akismet for spam detection.

## Run locally

Requires Node.js 22.12 or newer on a currently supported LTS release.

```sh
npm ci
cp .env.example .env
npm run db:migrate
npm run dev
```

Open [the widget demo](http://localhost:3000/demo). Set `ADMIN_PASSWORD` in `.env` to sign in to [moderation](http://localhost:3000/). The dashboard shows article counts and a review queue. Moderators can approve, hide, pin, and delete comments.

For production, run `npm run build` and then `npm start`. The build uses esbuild to minify the widget's JavaScript and CSS into `dist/widget/`. Run `npm run build:widget` to rebuild those two assets on their own. Run `npm run db:migrate` when setting up a database or deploying schema changes. Keep the SQLite file on persistent storage for a single server instance and back it up with SQLite's backup tools.

## Embed on a site

Add the site's origin to the comma-separated `ALLOWED_ORIGINS` list in `.env`. Set `PUBLIC_URL` to your Kucos server's public HTTPS origin for production, then use that origin in the snippet.

```html
<div id="comments"></div>
<script src="http://localhost:3000/min/kucos.min.js" defer></script>
```

Kucos uses the current page URL for the thread and strips its own comment permalinks from that URL. To share a thread across several URLs, set `data-article` on the container to a canonical URL on the same origin.

Visitors can reply, quote selected text, collapse replies, vote once per comment, and toggle kudos. They can edit their own comments for an hour. The widget keeps an anonymous identifier in the embedding site's browser storage, so edits and undoing kudos work when third-party cookies are blocked. Names, emails, and website links are optional. Emails stay out of the public API.

Comments support Markdown, including links, quotes, strikethrough, and fenced code with syntax highlighting. Start a line with `! ` for a spoiler. Use `:"quoted text":` for an inline quote.

## Configuration

| Variable | Behavior |
| --- | --- |
| `HOST` | Optional bind address. When unset, Node listens on all interfaces. |
| `PORT` | Defaults to `3000`. |
| `PUBLIC_URL` | Defaults to `http://localhost:3000` and follows `PORT` when unset. This origin can always embed the widget. |
| `DATABASE_URL` | Defaults to `file:./kucos.db`, relative to the project directory. |
| `ALLOWED_ORIGINS` | Comma-separated HTTP(S) origins that may embed Kucos and accept writes for their own article URLs. |
| `ADMIN_PASSWORD` | Enables the moderation dashboard. |
| `AKISMET_API_KEY` | Enables spam checks on new and edited comments and feedback from moderator decisions. |
| `AKISMET_TESTING` | Set to `true` to send Akismet requests in test mode. Defaults to `false`. |
| `TRUST_PROXY_HOPS` | Defaults to `0`, which uses the direct connection IP. Set it to the number of trusted proxy hops if the server is only reachable through those proxies. |

The public API allows 360 reads and 90 writes per IP in each 60-second window, per server process. CORS preflight requests are exempt. Requests over either quota receive `429` with a `Retry-After` header.

With Akismet enabled, Kucos sends the commenter IP address, browser user agent, comment, and optional identity fields to Akismet. It retains the submitter IP and user agent with the comment so moderators can report false positives or missed spam. If a spam check fails, the comment goes to the review queue. [Akismet developer documentation](https://akismet.com/developers/)

## Import from Kucos v1

Use `mongoexport` to export the legacy `comments`, `votes`, `spams`, and `kudos` collections into files named after each collection, such as `comments.json`. The importer accepts JSON Lines and JSON arrays. It requires `comments.json` and treats missing optional collections as empty. [MongoDB export documentation](https://www.mongodb.com/docs/database-tools/mongoexport/)

With a newly migrated SQLite database, run the import before accepting traffic.

```sh
npm run db:migrate
npm run db:import -- ./mongo-exports
```

The import keeps comment IDs and reply links, moderation flags, vote counts and records, and aggregate kudos totals. Kucos recalculates dashboard counts from the comments. The old database stored kudos totals without individual memberships. The new widget starts tracking individual kudos when it goes live. It also creates a new browser identifier, so returning visitors may be able to vote again after migration.

## Verify

```sh
npm test
npm run build
```

The tests use temporary SQLite databases and exercise threaded comments, edit ownership, duplicate votes and kudos, moderation, and origin handling.
