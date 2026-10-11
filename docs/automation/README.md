# Grok-first automatic blogging (MCP)

The site exposes a remote **MCP server** that Grok (via a Grok Automation) uses to
draft articles. The schedule, research and writing happen in Grok; the site only
validates, stores and — when the owner's policy explicitly allows — publishes.

## Endpoint

| Path | Purpose |
| --- | --- |
| `POST /mcp` | MCP, Streamable HTTP transport, stateless, JSON responses (protocol 2025-06-18; also 2025-03-26 / 2024-11-05). `GET`/`DELETE` → 405 (no SSE stream). |
| `/.well-known/oauth-protected-resource/mcp` | OAuth protected-resource metadata (RFC 9728) |
| `/.well-known/oauth-authorization-server` | OAuth authorization-server metadata (RFC 8414) |
| `/oauth/register` | Dynamic client registration (public clients, redirect allow-list) |
| `/oauth/authorize` | Owner approval page (enter `MCP_TOKEN`), S256 PKCE required |
| `/oauth/token` | `authorization_code` and `refresh_token` grants |

Code: `src/routes/mcp.ts`, `src/lib/mcp/*` (auth, protocol, tools, OAuth),
`src/lib/automation/*` (settings, policy, body conversion, image intake, provider),
`src/content/automation.server.ts` (storage), `src/routes/admin/automation.tsx` (desk).

### Tools

| Tool | Writes | What it does |
| --- | --- | --- |
| `get_blog_settings` | no | Site identity, automation status, topic ideas/sources, publishing policy, categories, tags, limits |
| `list_recent_articles` | no | Recent articles + source URLs of automated ones (dedupe) |
| `submit_article_draft` | draft only | Validated draft via the existing `saveArticle`; idempotent by `idempotency_key` and by content hash; returns quality flags |
| `publish_article_if_allowed` | maybe | Publishes an automation-created draft only if the policy allows; else returns reasons |
| `upload_featured_image` | media | Base64 or safe https URL → magic-byte check → existing `uploadMedia` (R2); optional cover on an automation draft |
| `record_run_result` | log | Records skipped/completed/failed runs (works while disabled/paused) |

There is no SQL passthrough, no generic admin API, and the desk session is never used
or exposed. Automation can only publish or attach images to drafts it created.

## Security

- **Secret:** `MCP_TOKEN` (32+ chars), separate from `ADMIN_TOKEN` / `ADMIN_SESSION_SECRET`.
  Not set ⇒ `/mcp` and `/oauth/*` answer 503 (disabled). Production has none today.
- **Auth:** `Authorization: Bearer <MCP_TOKEN>` (constant-time HMAC compare), or an
  OAuth access token (1 h) minted after the owner enters `MCP_TOKEN` on `/oauth/authorize`.
  Codes (5 min) and tokens are HMACs keyed by `MCP_TOKEN`: rotating it revokes every
  OAuth grant. Redirect URIs: https on `grok.com` / `x.ai` (+ subdomains), loopback http,
  or hosts listed in the optional `MCP_OAUTH_REDIRECT_HOSTS` var.
- **Every request:** browser `Origin` must be this site (403), rate limit `MCP_LIMITER`
  30 req / 60 s per IP before auth (429 + `Retry-After`), auth, `application/json`,
  2.5 MB body cap (413), JSON-RPC validation, then per-tool zod validation.
- **Every write tool** also checks: automation enabled and not paused, and the deployment
  is writable (existing write guard).
- **Audit:** `automation_runs` (tool, outcome, reason, article, auth method) — never tokens.
- **Images:** JPEG/PNG/WebP by magic bytes only (SVG/GIF/HTML rejected), 1.5 MB cap.
  URL fetch: https only, port 443, no IP literals, no localhost/.local/.internal/
  single-label hosts, no credentials, manual redirects (max 3, re-checked), streamed
  size cap, 10 s timeout.

## Publishing policy (desk → Automation)

Default: **automation disabled, auto-publish off** ⇒ everything stays a draft.
A piece is published only if ALL hold: automation enabled & not paused; auto-publish on;
its category is on the allow-list; it was created by automation and is still a draft; no
blocking flags (`too_short`, `missing_sources`, `insufficient_sources`,
`invalid_source_url`, `placeholder_text`, `duplicate_title`, `self_reported_uncertain`,
and `needs_featured_image` when "Require a featured image" is on); and the daily cap is
not reached. `unknown_tags_dropped` is advisory.

## Providers

- **`grok-mcp` (active):** Grok Automations call this MCP server. The site makes no AI requests.
- **`xai-api` (future, inactive):** would let the site call the xAI API itself. It only
  becomes "active" if an `XAI_API_KEY` secret exists AND the owner selects it, and even
  then this release ships no client — `runXaiProvider()` throws without any network request.

## Featured images — limitation

`upload_featured_image` was tested with real image bytes from an MCP client (SDK) against
the preview. **Whether Grok can actually send image bytes (or a usable URL) through a
custom connector is untested** and must be verified by the owner once. Until then the
desk shows "Image transfer: untested". If it does not work, drafts keep the
`needs_featured_image` flag and images are added in Desk → Media / the piece editor.

## Connect Grok

1. Set `MCP_TOKEN` on the Worker that serves the site (see "Production steps").
2. **grok.com → Connectors → New Connector → Custom**, URL `https://<site>/mcp`.
   Grok discovers OAuth via the 401 `WWW-Authenticate` header / metadata, registers,
   and opens `/oauth/authorize`: paste `MCP_TOKEN`, click Allow.
   If the form asks for fields manually: Authorization endpoint `https://<site>/oauth/authorize`,
   Token endpoint `https://<site>/oauth/token`, Client ID `dypol-mcp-client`, no client
   secret, scope `blog:automation`, PKCE / token auth method `none`.
   If Grok's callback host is not on grok.com/x.ai, add it to `MCP_OAUTH_REDIRECT_HOSTS`.
3. Grok CLI alternative: `grok mcp add --transport http dypol https://<site>/mcp --header "Authorization: Bearer ${DYPOL_MCP_TOKEN}"`.
4. Create a Grok Automation with `grok-automation-prompt.md`, scheduled daily.

## Production steps (not done in this PR)

1. Merge the PR (Workers Builds deploys both Workers; adds the `MCP_LIMITER` binding).
2. `npx wrangler d1 migrations apply DB --remote` (applies `0003_automation.sql`, additive).
3. `npx wrangler secret put MCP_TOKEN --name <worker>` with a fresh `openssl rand -hex 32`.
4. Desk → Automation: enable, keep auto-publish off until a few drafts look right.
