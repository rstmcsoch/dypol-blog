# SEO Starter Guide audit — DYPOL Blog (t89, 19 Oct 2026, Asia/Calcutta)

Source guide: https://developers.google.com/search/docs/fundamentals/seo-starter-guide (fetched live for this audit).
Live site audited: https://dypolblog.rstmcsoch.workers.dev — all 36 sitemap URLs fetched, plus robots/sitemaps/feed/404/alias checks. Repo on `main` (641514e) audited in parallel. PR #40 (PageSpeed, t88) is open/unmerged and based elsewhere; this branch is based on `main` and does not touch its files (no overlap expected except possibly `src/lib/seo.ts` image/thumbnail helpers — none changed there in #40's route code path conflict risk is low; rebase check needed if both touch sitemap).

## Summary counts (before this PR's fixes)

| Status | Count |
|---|---|
| DONE-GOOD | 20 |
| DONE-PARTIAL | 8 |
| MISSING (fixable in code) | 3 |
| NOT-APPLICABLE | 2 |
| OWNER-ONLY (GSC / content / promotion) | 4 (also noted inside partial rows) |

## Checklist

| # | Guide item | Status | Evidence |
|---|---|---|---|
| 1 | Google can find site / `site:` check | OWNER-ONLY | Code cannot verify GSC index coverage; owner to check `site:dypolblog.rstmcsoch.workers.dev` in GSC |
| 2 | Google sees page as user does (no cloaking/blocked CSS-JS) | DONE-GOOD | SSR HTML contains full title/meta/JSON-LD/content; robots allows `/` |
| 3 | Sitemap exists, absolute URLs | DONE-GOOD | `/sitemap.xml` 200, 36 URLs, article/topic lastmod; `/news-sitemap.xml` 48h only |
| 4 | Robots.txt correct | DONE-GOOD | Allows *, disallows /admin /preview /mcp /api/ /oauth/, lists both sitemaps; AI search bots allowed |
| 5 | Opt-out where needed (noindex) | DONE-GOOD | Admin noindex + robots disallow; empty topics `noindex, follow`; 404 noindex |
| 6 | Descriptive URLs | DONE-GOOD | `/articles/apple-iphone-duo-preorders-sell-out-2027`, `/topics/cybersecurity-privacy` — words, not IDs |
| 7 | Group similar pages in directories | DONE-GOOD | `/articles/*`, `/topics/*`, root static pages |
| 8 | Reduce duplicate / canonical | DONE-GOOD | Every sampled page self-canonical absolute on canonical host; alias `dypol-blog.…` canonicalises to `dypolblog.…`; trailing-slash article 307→clean URL |
| 9 | Easy-to-read, well-organised text, headings | DONE-PARTIAL → FIXED | Article h1 once, body h2/h3; but Markdown `#` in a static/home block could emit a second h1 — demoted to h2 in this PR |
| 10 | Unique content | DONE-PARTIAL | System supports original AI-drafted + human-approved stories (About/Editorial Policy state this); originality itself is editorial, not code-verifiable |
| 11 | Up-to-date content | DONE-PARTIAL | `dateModified`, sitemap lastmod, Corrections Policy exist; refreshing old stories is owner/editorial workflow |
| 12 | Helpful, reliable, people-first; expertise signals | DONE-PARTIAL | Editorial + Corrections policies, publisher Organization schema, human-review claim. **Gap:** articles attribute to Organization "DYPOL Labs", no named author/person bio — owner must supply real author identity if wanted; do not invent one |
| 13 | Expect readers' search terms | DONE-PARTIAL | 25 canonical topics, tags, editor SEO checklist (title/description/slug/600w/heading); no keyword stuffing |
| 14 | Avoid distracting ads/interstitials | DONE-GOOD | No ads/interstitials on public site |
| 15 | Link to relevant resources | DONE-PARTIAL | Strong internal: article→topics, related, newer/older, footer pages, homepage blocks (19–22 internal links/article sampled). External source links inside article body blocks are not a structured block type — editorial limitation to flag |
| 16 | Good link (anchor) text | DONE-GOOD | Neighbour/related links use full article titles; topic links use topic labels; no "click here" pattern found |
| 17 | nofollow untrusted/UGC links | DONE-PARTIAL / N-A in practice | No comments/UGC; Markdown external links use `rel="noreferrer"` (target _blank). No user links to distrust today |
| 18 | Unique, clear, concise title links | DONE-GOOD | 36/36 sampled titles unique, none >65 chars, article titles distinct from H1 where SEO title set |
| 19 | Control snippets / meta descriptions | DONE-PARTIAL → FIXED | Articles excellent (112–157 chars sampled); **topic descriptions 44–61 chars and /articles 36 chars were thin** — enriched in this PR; article descriptions now capped at 160 on word boundary |
| 20 | High-quality images near relevant text | DONE-GOOD | Cover directly under article header; cards use cover thumbs (PR #40 improves delivery, unmerged) |
| 21 | Descriptive alt text | DONE-GOOD | Sampled articles/home: 0 images missing alt; cover alt stored per-media with title fallback in code |
| 22 | Optimise videos | NOT-APPLICABLE | No video pages |
| 23 | Promote the website | OWNER-ONLY | Social/community/offline promotion; footer social slots exist but promotion is owner's work |
| 24 | Don't use meta keywords | DONE-GOOD | No `keywords` meta anywhere (correctly absent) |
| 25 | Don't keyword-stuff | DONE-GOOD | Titles/descriptions read naturally in sample |
| 26 | Keywords in domain/URL not a ranking lever | DONE-GOOD | Descriptive slugs for users/breadcrumbs, not stuffing |
| 27 | No magic content length | DONE-PARTIAL | Editor checklist asks ≥600 words as a *readiness* hint — keep as quality hint, not a ranking promise (guide says length alone doesn't rank) |
| 28 | Subdomains vs subdirectories | DONE-GOOD | Single host, subdirectories |
| 29 | Heading order/number | DONE-PARTIAL → FIXED | See #9; guide notes order matters mainly for accessibility |
| 30 | Structured data eligibility | DONE-PARTIAL → FIXED | NewsArticle + Breadcrumb (articles), Breadcrumb+ItemList (topics), WebSite/Organization (home), ItemList (indexes) already valid JSON in sample. **Static pages (About/policies/contact) had none** — BreadcrumbList added |
| 31 | Mobile-friendly + HTTPS | DONE-GOOD | Viewport meta, responsive site (t73), HTTPS on workers.dev, canonical https |
| 32 | Search Console setup/monitoring | OWNER-ONLY | Owner already uses GSC (AMP/PageSpeed reports seen in t86/t88); keep monitoring Coverage, CWV, AMP (validate-fix), generative-AI control stays **Include** (t87 decision) |
| 33 | Image discovery via sitemap | MISSING → FIXED | Main sitemap had no `image:image` — added cover image + title per article |
| 34 | Accurate sitemap lastmod for static pages | MISSING → FIXED | Static pages emitted no lastmod despite `pages.updated_at` existing — now plumbed through `readPageLinks → readSitemap → /sitemap.xml` |

## Best already-done items
Canonical consolidation to one host, NewsArticle/Breadcrumb schema, news sitemap (48h), RSS, robots/noindex hygiene, unique titles, descriptive slugs, per-media alt text, empty-topic noindex, favicon/manifest/OG-Twitter completeness — all verified live, not just in code.

## Gaps fixed in this PR (ranked)
1. Thin topic/index meta descriptions (44–61 / 36 chars) → `topicMetaDescription()` + fuller index description; article descriptions capped via `metaDescription()`.
2. No image sitemap entries → `image:image` (cover + title) in `/sitemap.xml`.
3. Static pages: no structured data + no sitemap lastmod → BreadcrumbList on About + all `$page` routes; lastmod plumbed from DB.
4. Possible duplicate h1 from Markdown `#` → demoted to h2 (page/home already provides the h1).

## Intentionally NOT done (per guide "things not to focus on")
No meta keywords, no keyword stuffing, no domain/URL keyword chasing, no word-count ranking claims, no AMP build (t86 decision stands), no bought links, no invented author bio/fake E-E-A-T signals, no homepage/header/footer visual changes.

## Owner-only actions
- GSC: `site:` check, submit/confirm both sitemaps, monitor Coverage + Core Web Vitals (28-day field data), Validate-Fix on the AMP report, keep generative-AI control on Include.
- Content: decide whether to add a real named author/editor bio (structural Organization attribution already exists); refresh/correct old articles over time; add external source links editorially where a story relies on them; promote new stories (social/community/newsletter).
- After merge/deploy: re-run a PageSpeed + Rich Results test on one article, one topic and About to confirm Breadcrumb eligibility, and check `/sitemap.xml` shows `<image:image>` and static-page `<lastmod>`.

## Verification
- Live before: 36 sitemap URLs — 0 duplicate titles, canonical on 36/36, 1 h1 each, 0 missing alts, articles NewsArticle+Breadcrumb, static pages 0 JSON-LD, topic desc 44–61 chars.
- Local after (wrangler dev on built output): `/sitemap.xml` emits `xmlns:image` + static-page `<lastmod>2026-10-18…`; unit tests 208/208 pass (`test:src`); `test:scripts` 188 pass / 9 fail — identical 9 failures on unmodified `main` (pre-existing grok-pwa-plugin tests); typecheck clean; build succeeds.
