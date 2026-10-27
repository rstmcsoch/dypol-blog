# DYPOL Blog

Technology news and explainers from DYPOL Labs — live at
https://blog.dypol.workers.dev

## Stack

- **Frontend/server:** React + TanStack Router/Start (SSR), built with Vite (vinext)
- **Hosting:** Cloudflare Workers (`blog` on the `dypol` workers.dev subdomain), D1 (`dypol-blog-db`) for content/settings, R2 (`dypol-blog-media`) for images
- **Content:** articles in D1 with a 25-topic taxonomy, admin panel at `/admin`, AI publishing via the blog's MCP tools (see `docs/automation/`)
- **SEO:** dynamic sitemap + news sitemap, RSS feed, OG/Twitter cards, NewsArticle/WebSite/Organization JSON-LD (see `SEO-REPORT.md`)

## Develop

npm install
npm run dev        # local dev
npm run build      # production build (regenerates the route tree)
npm run typecheck
npm test           # unit + script tests

Local D1 migrations live in `migrations/d1/` and are applied with
`wrangler d1 migrations apply DB --local` (production: `--remote`, or the
Cloudflare D1 API). Production deploys happen through Cloudflare Workers
Builds on merge to `main`.

## Docs

- `docs/ADMIN-GUIDE.md` — owner/admin guide (articles, topics, pages, automation)
- `docs/automation/automation-prompt.md` — the AI publishing prompt
- `SEO-REPORT.md` — SEO audit and implementation record
