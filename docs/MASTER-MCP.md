# DYPOL Blog Master MCP

The Master MCP is the website owner's AI operations control plane. It is part of the existing MCP server at `/mcp`, not a second CMS.

## Connecting an external agent

1. Sign in to the admin desk and open **Settings → Master MCP**.
2. Click **Create credential**. Copy the secret immediately. Only a hash is stored; it cannot be shown again. Rotate, deactivate or revoke it from the same page at any time.
3. In the external agent, add an MCP server:
   - URL: `https://<your-site>/mcp` (production: `https://blog.dypol.workers.dev/mcp`)
   - Header: `Authorization: Bearer <the secret>`
4. Optional: if the agent requires OAuth 2.1 + PKCE, create a Master OAuth client on the same page. Paste the redirect URL the agent shows (do not invent one). Copy the client ID and secret once. Approve the connection while signed in to the desk, or with the site `MCP_TOKEN` — never with a publishing profile API key.

The existing Default profile `MCP_TOKEN` and per-profile API keys keep their current meaning and do not receive Master privileges.

## What it can do

Content and publishing (including published articles), supervision of existing Normal and Special automation profiles (pause/resume/enable/disable, writers, quotas, sources, schedules), analytics, media, events, pages, topics, tags, ticker, structured ads, contact messages, and permitted website appearance and text.

Daily AI publishing caps use the **UTC** calendar day. The website-wide cap remains the overriding safety ceiling. A new per-profile daily cap, `maxArticlesPerDay` (0 = none), is stored in the profile policy and is *not* the pre-t64 field `maxPublishedPerDay` (that migrated to the per-run cap).

## What it cannot do

It cannot delete the website, Worker, D1 database or R2 bucket; change Cloudflare ownership, secrets, bindings or schema; access Security or administrator login, passwords, 2FA, recovery codes, sessions or grants; read or rotate `ADMIN_TOKEN`, `ADMIN_SESSION_SECRET` or `MCP_TOKEN`; create or delete automation profiles or their API keys/OAuth clients; create or change Master credentials; run arbitrary SQL or JavaScript; or add unrestricted custom head scripts or new executable ad JavaScript.

Rejected operations return an explicit explanation. Pausing a profile blocks further authorized website operations; it does not terminate an external AI process. A queued task is not complete until the target profile reports completion.

## Tools

Grouped tools include `get_master_overview`, `get_site_health`, `get_activity_feed`, `get_daily_publishing_report`, `get_master_permissions`; article tools including two-stage `preview_article_deletion` / `delete_article`; automation supervision and author tools; agent-task assignment; website configuration (settings, homepage, site text, appearance, pages, topics, tags, ticker, events, media, structured ads, messages); and analytics.

Publishing profiles also have `list_my_agent_tasks`, `claim_agent_task` and `report_agent_task`.

## Activity and audit

Every important Master mutation is written to the Master audit log (visible on the Settings tab) and to **Activity**, labelled **Master MCP**, distinct from **Administrator**, **Normal MCP** and **Special MCP**. Credentials are never stored in logs.
