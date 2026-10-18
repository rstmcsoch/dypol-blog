# Automatic blogging through any AI connector (MCP)

The site exposes a standard remote **MCP server**. Any AI app that supports remote MCP
connectors (Claude, ChatGPT, Grok, Cursor, Claude Code, VS Code, Gemini CLI, ...) can
use it to draft articles. The schedule, research and writing happen in that app; the
site only validates, stores and — when the owner's policy explicitly allows — publishes.

## Endpoint

| Path | Purpose |
| --- | --- |
| `POST /mcp` | MCP, Streamable HTTP transport, stateless, JSON responses (protocol 2025-06-18; also 2025-03-26 / 2024-11-05). `GET`/`DELETE` → 405 (no SSE stream). |
| `/.well-known/oauth-protected-resource/mcp` | OAuth protected-resource metadata (RFC 9728) |
| `/.well-known/oauth-authorization-server` | OAuth authorization-server metadata (RFC 8414) |
| `/oauth/register` | Dynamic client registration (RFC 7591, public clients, redirect allow-list; returns a signed `client_id` that remembers the client name + redirect URIs) |
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
  OAuth grant and every registered client.
- **Redirect URIs (DCR and authorize):** https on a known MCP client host (+ subdomains):
  `claude.ai`, `claude.com`, `chatgpt.com`, `openai.com`, `grok.com`, `x.ai`, `cursor.com`,
  `vscode.dev`, `perplexity.ai`; loopback `http://127.0.0.1|localhost|[::1]` on **any port**
  (RFC 8252 §7.3, for desktop/CLI apps); `cursor://anysphere.cursor-mcp/...`; plus hosts in
  the `MCP_OAUTH_REDIRECT_HOSTS` var or Desk → Automation → "Extra client hosts".
  A client registered via DCR may only use the redirect URIs it registered (loopback
  matched port-agnostically). The fixed legacy id `dypol-mcp-client` (manual Grok setup)
  still works against the host allow-list. The consent page names the client and warns
  for loopback redirects.
- **Every request:** browser `Origin` must be this site or a known client host (403), rate limit `MCP_LIMITER`
  30 req / 60 s per IP before auth (429 + `Retry-After`), auth, `application/json`,
  2.5 MB body cap (413), JSON-RPC validation, then per-tool zod validation.
- **Every write tool** also checks: automation enabled and not paused, and the deployment
  is writable (existing write guard).
- **Audit:** `automation_runs` (tool, outcome, reason, article, client: `bearer`, `oauth`,
  or `oauth:<registered client name>`) — never tokens. Client names are self-asserted.
- **Images:** JPEG/PNG/WebP by magic bytes only (SVG/GIF/HTML rejected), 10 MB cap.
  URL fetch: https only, port 443, no IP literals, no localhost/.local/.internal/
  single-label hosts, no credentials, manual redirects (max 3, re-checked), streamed
  size cap, 10 s timeout.

## Publishing policy (desk → Automation)

Default: **automation disabled, auto-publish off** ⇒ everything stays a draft.
A piece is published only if ALL hold: automation enabled & not paused; auto-publish on;
its category is on the allow-list; it was created by automation and is still a draft; no
blocking flags (`too_short`, `missing_sources`, `insufficient_sources`,
`invalid_source_url`, `placeholder_text`, `duplicate_title`, `self_reported_uncertain`,
and `needs_featured_image` when "Require a featured image" is on); the per-run cap
(Automation tab: "Maximum articles per run", counted per run_id or 30-minute burst)
is not reached; and the whole-website daily AI cap (Settings) is not reached.
`unknown_tags_dropped` is advisory. Explicit publishes ignore the policy rules
above but never the two hard caps.

## Modes and providers

- **`mcp-connector` (default, active):** your AI app calls this site's MCP tools on its
  own schedule. The site makes no AI requests. (Replaces `grok-mcp`; stored legacy values
  are migrated on read: `grok-mcp` → `mcp-connector`, `xai-api` → `server-api` + xAI.)
- **`server-api` (abstraction only):** the site would call an AI API itself. Providers:
  xAI, OpenAI, Anthropic, Google Gemini, OpenRouter, or any OpenAI-compatible endpoint
  (custom https base URL + model; base URL passes the same SSRF rules as image fetches).
  Keys are **only** Worker secrets: `XAI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
  `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, or the generic `AI_API_KEY` (fallback, and the
  only key for openai-compatible). Active only when selected AND the key exists. The
  adapters (`src/lib/automation/provider.ts`) build and parse requests and are unit-tested
  with a mocked `fetch`; **nothing schedules a run in this release, so no request is made.**
  The desk shows which key names are set, never values.

## Featured images — limitation

`upload_featured_image` was tested with real image bytes from an MCP client (SDK) against
the preview. **Whether a given AI app can actually send image bytes (or a usable URL) through a
custom connector is untested** and must be verified by the owner once. Until then the
desk shows "Image transfer: untested" (verify per app). If it does not work, drafts keep the
`needs_featured_image` flag and images are added in Desk → Media / the piece editor.

## Connect an AI app

Everything starts from one URL: `https://<site>/mcp`. Apps that support OAuth discover
the rest from the 401 `WWW-Authenticate` header and metadata, register themselves (DCR),
and open `/oauth/authorize`: **paste `MCP_TOKEN`, click Allow.** Apps that take headers
use `Authorization: Bearer <MCP_TOKEN>` directly. Scope: `blog:automation`.

### Claude (claude.ai web, Desktop, mobile)
Settings → Connectors → Add custom connector → name "DYPOL Blog", URL `https://<site>/mcp`
(leave OAuth Client ID/Secret empty) → Connect → approve with `MCP_TOKEN`.
Callback used: `https://claude.ai/api/mcp/auth_callback` (or claude.com) — allowed.
Custom connectors need a paid Claude plan. Schedule: a recurring Claude task/project, or
use Claude Code below on a cron.

### ChatGPT
Settings → Apps & Connectors → Advanced → enable Developer mode → Create → URL
`https://<site>/mcp`, Authentication: OAuth → approve with `MCP_TOKEN`.
Callback: `https://chatgpt.com/connector_platform_oauth_redirect` (and newer chatgpt.com
paths) — allowed. Write tools require developer mode; plan availability varies.
Schedule: ChatGPT Tasks with the prompt, if your plan allows connectors in tasks.

### Grok
grok.com → Connectors → New Connector → Custom → URL `https://<site>/mcp`, approve with
`MCP_TOKEN`. If Grok asks for fields manually: Authorization endpoint
`https://<site>/oauth/authorize`, Token endpoint `https://<site>/oauth/token`, Client ID
`dypol-mcp-client`, no secret, scope `blog:automation`, auth method none (PKCE).
Schedule: a Grok Automation with the prompt. (Verified end to end in this project.)

### Claude Code, Cursor, VS Code, Gemini CLI, Grok CLI (bearer header — simplest)
- Claude Code: `claude mcp add --transport http dypol https://<site>/mcp --header "Authorization: Bearer $DYPOL_MCP_TOKEN"`
  (or omit the header and run `/mcp` → Authenticate for OAuth via a loopback callback).
- Cursor `~/.cursor/mcp.json`: `{"mcpServers":{"dypol":{"url":"https://<site>/mcp","headers":{"Authorization":"Bearer ${env:DYPOL_MCP_TOKEN}"}}}}`
  (OAuth also works: `http://localhost:8787/callback` or `cursor://anysphere.cursor-mcp/oauth/callback`).
- VS Code `.vscode/mcp.json`: `{"servers":{"dypol":{"type":"http","url":"https://<site>/mcp","headers":{"Authorization":"Bearer ${input:dypol}"}}},"inputs":[{"id":"dypol","type":"promptString","password":true,"description":"DYPOL MCP token"}]}`
- Gemini CLI `~/.gemini/settings.json`: `{"mcpServers":{"dypol":{"httpUrl":"https://<site>/mcp","headers":{"Authorization":"Bearer $DYPOL_MCP_TOKEN"}}}}`
- Grok CLI: `grok mcp add --transport http dypol https://<site>/mcp --header "Authorization: Bearer ${DYPOL_MCP_TOKEN}"`.
- Schedule headless with cron, e.g. `claude -p "$(cat automation-prompt.md)"` daily.

### Any other MCP client
If its OAuth callback is on a host not listed above, add that host in Desk → Automation →
"Extra client hosts" (or the `MCP_OAUTH_REDIRECT_HOSTS` var), or use the bearer header.

Then create the daily task with `automation-prompt.md`.

## Production steps (not done in this PR)

1. Merge the PR (Workers Builds deploys both Workers; adds the `MCP_LIMITER` binding).
2. `npx wrangler d1 migrations apply DB --remote` (applies `0003_automation.sql`, additive).
3. `npx wrangler secret put MCP_TOKEN --name <worker>` with a fresh `openssl rand -hex 32`.
4. Desk → Automation: enable, keep auto-publish off until a few drafts look right.
