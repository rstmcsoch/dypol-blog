# DYPOL Blog admin panel — research report (t68, 18 Oct 2026)

## What modern news CMSs include (WordPress, Ghost, Substack, Newspack/newsroom CMSs)

Researched against current WordPress/Ghost feature sets and solo-publisher
guidance. Recurring industry-standard admin features: dashboard with traffic
+ content stats; post list with search/filter/status/sort, bulk actions;
drafts + **scheduled publishing**; **revisions/history with restore**; editor
with autosave, SEO panel (meta title/description with counters, slug, preview),
checklists; **media library with search, alt text, variants**; homepage
curation; analytics (top posts, views); comments moderation; newsletter/
subscribers; users & roles/approval workflows; site health, backups, settings
export; audit/activity log; broken-link/404 tools.

## Audit of OUR admin (evidence: src/routes/admin/*, src/content/repository.server.ts)

Existing: Dashboard (counts, needs-attention, recent), Articles (search,
status/topic/tag filters, sort, delete, AI-edit grant, delete-old), Editor
(blocks editor, SEO title/description fields, cover, topics/tags, publish
intents), Topics & tags, Media (upload/list/delete, variant sizes + backfill),
Homepage builder, Ticker, Site text, Pages, Appearance, Automation (profiles,
policy, per-run/website limits, runs, topic ideas), Settings (identity, logo,
social links, AI website limit, access), Help. Public side already has SEO
(sitemaps/feed/JSON-LD), image pipeline, view counter (article_views totals).

## Feature table (solo-operator fit)

| Feature | Industry standard | We have | Solo value | Effort | Verdict |
|---|---|---|---|---|---|
| Dashboard stats/traffic | WordPress/Ghost home: views, top posts | Partial (counts only) | High | Low | **MUST (this PR)** |
| Article list search/filter/sort | Standard | Have | — | — | Done already |
| Views + word count in list | Standard (WP columns) | Missing | High | Low | **MUST** |
| Clone/duplicate article | WP/Ghost duplicate | Missing | High (series/templates) | Low | **MUST** |
| Scheduled publishing | Ghost/WP native | Missing | High (batch writing) | Med | **MUST** — lazy sweep, no cron exists; honest: flips on first request after due time |
| SEO checklist per article | Yoast/RankMath staple | Fields exist, no guidance | High | Low | **MUST** |
| Media search | Standard | Missing (list only) | Med | Low | **SHOULD (this PR)** |
| Site health page | WP Site Health | Missing | High for solo (no IT dept) | Low | **MUST** |
| Settings backup export/import | WP exporters | Missing | High (recovery) | Low | **MUST** |
| Recent automation runs on dashboard | Newsroom desks | On Automation page only | Med | Low | **SHOULD (dashboard widget)** |
| Revisions/history restore | WP/Ghost core | Missing | Med | Med-High (storage+UI) | Roadmap next — clone+drafts mitigate; do properly later |
| Activity log (admin actions) | Audit plugins | Partial (automation runs) | Med | Med | Roadmap; dashboard shows automation runs now |
| Bulk actions | WP list | Missing | Low solo | Low | Skip for now |
| Comments/moderation | Ghost/Substack | No comments on site | Skip | — | Skip (would need public comments first) |
| Newsletter/subscribers | Ghost/Substack core | None | Med later | High (provider, lists, sending) | Skip until audience asks |
| Users/roles/approvals | Newsroom CMS | Single admin by design | Skip | High | Skip — solo; MCP profile boundaries already cover AI |
| Broken link/404 log | Plugins | Missing | Low-Med | Med | Roadmap if SEO work grows |
| Internal link suggestions | Plugins/AI | Missing | Low | Med | Skip |

## Roadmap

- **Must (this PR):** dashboard upgrade (total views, top articles, this-week
  publishes, drafts, recent automation runs, quick actions), article list
  views/words columns + Duplicate, scheduled publishing (status stays draft +
  scheduled time; a sweep on site requests publishes when due — documented
  limitation, no fake cron), per-article SEO checklist + character counters,
  Site Health page (counts, storage incl. image variants, orphan media, feed/
  sitemap/robots links), settings backup export/import JSON.
- **Should (this PR if clean):** media search filter; dashboard recent-runs.
- **Next:** revisions-lite (snapshot on save + restore), unified activity log,
  404 log.
- **Skip:** multi-user roles/approvals, comments, newsletter, bulk actions —
  enterprise/team features with no solo payoff today.

## Scheduling honesty note

Workers here have no cron trigger configured. Scheduled articles will be
published by a sweep that runs on incoming site/admin requests once their
time passes (checked at most every ~30s per instance) — in practice the
moment anyone (reader, bot, owner) loads the site after the due time. The
editor and health page state this plainly. If exact-to-the-minute timing is
ever needed, add a Cloudflare Cron Trigger calling the same sweep.

## Implementation status (added after build)

Implemented in the t68 PR (from the Must/Should rows): dashboard upgrade,
views/words columns + Duplicate, scheduled publishing (request-time sweep,
applied locally and verified end-to-end), SEO checklist + counters, media
search, Site health page, settings backup export/import, dashboard recent
automation runs. Deferred per roadmap: revisions-lite, unified activity log,
404 log. Skips stand (roles, comments, newsletter, bulk actions).
