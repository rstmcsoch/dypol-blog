# Engineer reports — comparison and phased plan (t91, 19 Oct 2026)

## Which report is which

| ID | File (as supplied) | Title / author line | Scope |
|---|---|---|---|
| **Report A** | `a2e5bd5f…md` (66 KB, 684 lines) | *DYPOL Blog: Technology & AI Editorial Benchmark Report*, 19 Oct 2026 | Editorial benchmark vs 23 competitor destinations; per-article audit of all 9 DYPOL stories; P0/P1/P2 priorities; 30-day roadmap |
| **Report B** | `bf9386dd…md` (190 KB, 1,863 lines) | *DYPOLBlog vs. the Top Tech & AI Publishers — Editorial Report*, prepared for RSTMC / DYPOL Labs | Same 9 articles + 24 outlets, ~55 competitor articles, HN/Google News demand signals, plus a full raw-HTML site/SEO appendix and per-site teardowns |

Both are **editorial** reports. Neither is a code audit. Every technical claim was
re-verified against repo `main` (0cea5c4) and the live site before planning.

## Counts (deduplicated actionable recommendations)

| Bucket | Count |
|---|---:|
| Unique actionable items extracted (after dedup) | 38 |
| COMMON (both reports) | 17 |
| UNIQUE-A (Report A only) | 9 |
| UNIQUE-B (Report B only) | 12 |
| Already done / report claim no longer true (verified) | 11 |
| DO in code (this task, phased PRs) | 10 |
| SKIP (risky, conflicts with owner rules, or no value) | 7 |
| OWNER-DECISION (content/business call, not code) | 10 |

## Already done — verified with evidence, NOT redone

| Item | Reports | Evidence on current main/live |
|---|---|---|
| ISO-8601 machine dates | B #1 (claimed broken) | `seo.ts:isoOrNull()` → `toISOString()`; live DeepSeek page: `"datePublished":"2026-10-19T00:54:15.449Z"`, `article:published_time` ISO, news-sitemap `<news:publication_date>2026-10-19T00:54:55.330Z</news:publication_date>`. Report B read the human display string, not the emitted machine value. |
| Empty topics indexable | A/B | `topics/$slug.tsx` adds `noindex, follow` when 0 articles; empty topics excluded from `sitemap.xml` (only 13 filled topics listed, verified live). |
| Meta descriptions, canonical, 1×H1, NewsArticle+Breadcrumb, image sitemap, news sitemap, RSS | A P2 | PRs #18/#22/#41: `seo.ts` (160-char cap, topic descriptions), `seo.test.ts`. |
| Thumb variants, LCP preload, immutable assets, font handling | (speed) | PR #40; not touched again. |
| AMP | — | PR #39 guard; site is not AMP by design. |
| Social links "fake" | B #4 | Footer renders **only** configured+visible socials (`visibleSocials()`); default config has none set, so no bare x.com/facebook.com icons are emitted. Real profiles are OWNER-DECISION (URLs needed). |
| Contact has no contact route | B | Live /contact gives tip/correction/copyright routes; footer mailto renders only if configured. Adding a public email address is OWNER-DECISION. |
| Fluid responsive, no overflow | — | PR #29 240-gate; every phase re-runs it. |
| AI-crawler-friendly robots, policy pages, AI disclosure | A/B praise | Already present; untouched. |
| `/admin` single entry, password+2FA login | — | PRs #33–#38; untouched. |
| Headline/dek craft, topic selection, hedging | A/B praise | Editorial, already working; no code change. |

## COMMON (17) — both reports

At-a-glance/Key-takeaways box · tables for number-dense stories · bold key facts ·
clickable inline + Sources links · internal links/topic network · named author +
author page + Person schema · visible Updated stamp · headline must match body
(no overclaim) · attribution labels (vendor vs measured vs forecast) · caveat early ·
"what it means for you / what to do" section · practical formats (how-to, comparison,
security guide) · descriptive/question headings, shorter paragraphs · primary sources
first · original testing/own numbers · vary length/format · measure with own analytics.

## UNIQUE-A (9)

Per-article fixes for each of the 9 stories · Demonstrated-vs-projected table pattern ·
publisher checklist for AI-Overview stories · content-mix percentages · editorial
workflow checklist (accuracy/reader-value/trust) · "does-not-guarantee-AI-citation"
caution · author/reviewer (not just author) role · Search Console measurement loop ·
glossary for specialist terms.

## UNIQUE-B (12)

Broken-date claim (disproven, see above) · `aiDailyPublishLimit` visible in public
payload · batch-publish timestamps 5s apart · brand-name inconsistency
(DYPOL Blog/Blogs/LABS) · Trending rotor shows oldest article · homepage H1 is the
featured article's headline · RSS summary-only, no images · no site search/newsletter ·
Willow article leaked fact-check note + wrong-chip alt text · mis-filed topics
(DeepSeek→Startups) · dek/body mismatch (TSMC "sixth straight") · 12 repeated
thumbnails per article page.

## DO — phased implementation (each phase = own PR off main, owner merges)

| Phase | PR focus | Items |
|---|---|---|
| 1 | Article rendering & freshness | Clickable Sources + inline `[label](url)`/`**bold**`/bare-URL rendering in article body (render-only; storage & MCP contract unchanged); visible "Updated …" stamp when genuinely edited. |
| 2 | Article structure blocks | New `table` + `takeaways` ("At a glance") blocks end-to-end: type, validation, automation markdown tables/`## At a glance` parsing + inverse, editor fields, responsive rendering. |
| 3 | Trust & feed plumbing | Organization `sameAs` from configured socials; `og:image:alt`; RSS full text (`content:encoded`) + cover enclosure; strip `aiDailyPublishLimit` from the public shell payload. |
| 4 | Editorial guardrails (non-blocking) | Editor checklist additions: links present, takeaways/table on long pieces, reader-action heading — hints only, never a publish gate, no automation/MCP behaviour change. |

## SKIP — with reasons

Keyword-stuffing/SEO tricks (both reports warn against; owner rules) · fake
engagement (polls with invented votes, featured comments, comments system for a
solo site — no moderation capacity, spam risk) · newsletter/site-search build
(new subsystem + provider decision; OWNER-DECISION if wanted later) · custom
domain & workers.dev move (infra/business, not code in this task) · changing
homepage/header/footer visuals (owner-approved, forbidden) · renaming any MCP
contract field (`get_blog_settings`, `source_urls`, `idempotency_key`,
`automation.active`, `minWords`, `uncertain`, `article_id`,
`needs_featured_image`, …) · D1 migrations (none needed; all phases are
render/type/plumbing only).

## OWNER-DECISION — needs his call/content, not code

Named author identity, bio, photo and `sameAs` profiles (Person schema waits on
this) · real social profile URLs · public contact email/form · rewriting the 9
live articles (DeepSeek/Apple headlines, TSMC dek, Willow rebuild, alt texts,
topic re-filing) — live content edits are never done silently · brand-name
choice (DYPOL Blog vs DYPOL Labs) in byline/schema · Analysis/Explainer labels
taxonomy · publishing cadence staggering · India-angle/original-testing content
programme · newsletter & search as products · analytics choice beyond existing
view counts.

## Safety contract for every phase

No D1 migration. No homepage/header/footer visual change. No MCP field rename
or behaviour change. No publish-gate change. Gates per phase:
`npm run test:src`, `tsc --noEmit`, `npm run build`, `test:e2e:seo`,
responsive 240-gate, plus a bundle/image sanity check (thumbs, preloads and
immutable `/assets` headers untouched).
