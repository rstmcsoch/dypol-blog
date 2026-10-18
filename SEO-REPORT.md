# DYPOL Blog — SEO & Traffic Report (t48)

**Site:** https://dypolblog.rstmcsoch.workers.dev · **Date:** 18 Oct 2026 · **Companion PR:** #18 (branch `t48-seo`, not merged — review before it goes live)
**Scope:** research (2026 best practice) → live audit → everything implementable from the code side, implemented in the PR. Account-side items are listed separately for Rustam with exact steps.

---

## 1. Executive summary

The site was already doing the basics right (unique titles/descriptions, a sitemap, `BlogPosting` schema, login noindex, fast small pages). It was missing the layer that makes articles **shareable, feed-readable and rich-result eligible**: no Open Graph/Twitter cards, no RSS feed, relative canonicals, thin JSON-LD (no image/author), empty image `alt` text everywhere, a broken web-manifest link, and no news sitemap.

PR #18 implements all of that (details in §5), with unit + e2e tests. Nothing about design, article text or titles changed. What code cannot do — Google Search Console, Bing Webmaster, IndexNow keys, analytics accounts, backlinks — is in §6 with exact steps.

**Honest expectations:** these changes make every article eligible for rich results, Discover large-image previews and feed readers, and remove crawl/index friction. They do not guarantee rankings. Traffic growth for a young tech blog comes mostly from consistent, well-filed, well-sourced articles (the automation already does this) plus topical authority over months and some external links. Expect indexing quality to improve within days of Search Console submission; visible ranking movement is a weeks-to-months game. Anyone promising faster is selling something.

---

## 2. What the research says (2026 best practice, cited)

- **Article structured data.** Google supports `Article` / `NewsArticle` / `BlogPosting` JSON-LD; recommended properties include `headline` (≤110 chars), `image`, ISO-8601 `datePublished`/`dateModified` with timezone, and `author` (Person/Organization with a URL that identifies them). No required properties, but "add as many recommended properties as apply", validate with the Rich Results Test, and keep the sitemap submitted so Google learns about changes. [1]
- **Google News technical guidelines.** Articles must be crawlable at unique permanent URLs with clear visible publication dates and bylines; section pages should link articles with plain anchor links (not JS-only). [2]
- **News sitemaps.** A separate (or extended) news sitemap containing only articles from the **last two days**, with publication name/language, `news:publication_date` and `news:title`; update it as articles publish. [3]
- **Google Discover.** No special markup needed; eligibility = indexed + content policy. Big wins: relevant images **≥1200 px wide, 16:9, >300k pixels**, `max-image-preview:large` enabled, `og:image` pointing at a representative non-generic image, no clickbait/sensationalism, accurate titles. [4]
- **Publisher article-page best practices.** Correct `datePublished`/`dateModified`, headline ≤110 chars, an image that belongs to the article, `isAccessibleForFree`, `author.url`. [5]
- **Core Web Vitals.** LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 at the 75th percentile of real users; all three must pass. A genuine but *small* ranking signal — relevance and content quality dominate. Common CLS causes: images without dimensions. [6][7]
- **IndexNow.** Bing (and others) accept push notification of new/updated/deleted URLs (up to 10,000 per POST) keyed by a hosted key file; speeds up non-Google discovery, guarantees nothing. [8]
- **General technical hygiene** (long-standing, still current): descriptive URLs, one canonical per page (absolute preferred), crawlable internal links, noindex only for private/thin pages, sitemap with `<lastmod>`, RSS/Atom for feed readers and aggregators, correct 404s, consistent trailing-slash/host.

Sources:
[1] https://developers.google.com/search/docs/appearance/structured-data/article
[2] https://support.google.com/news/publisher-center/answer/9606708
[3] https://developers.google.com/search/docs/crawling-indexing/sitemaps/news-sitemap
[4] https://developers.google.com/search/docs/appearance/google-discover
[5] https://support.google.com/news/publisher-center/answer/9607104
[6] https://web.dev/articles/vitals
[7] https://developers.google.com/search/docs/appearance/core-web-vitals
[8] https://www.indexnow.org/documentation

---

## 3. Live audit of the current site (18 Oct 2026, pre-PR)

| Area | State | Evidence |
|---|---|---|
| Titles / meta descriptions | ✅ Have | Per-article `seo_title`/`seo_description` with excerpt fallback |
| Canonical | ⚠️ Relative | `<link rel="canonical" href="/articles/…">` — resolvable, but absolute is preferred |
| Open Graph / Twitter cards | ❌ Missing | Zero `og:`/`twitter:` tags on home and articles — links shared anywhere show no card |
| Article schema | ⚠️ Thin | `BlogPosting` with headline+dates only; no `image`, `author`, `mainEntityOfPage`, publisher logo |
| WebSite / Organization schema | ❌ Missing | None on homepage |
| Breadcrumbs schema | ❌ Missing | No `BreadcrumbList` anywhere |
| Topic/list schema | ❌ Missing | No `ItemList` on /topics, /articles |
| Sitemap | ⚠️ Basic | All articles+topics, absolute URLs, but **no `<lastmod>`** |
| News sitemap | ❌ Missing | — |
| RSS/Atom feed | ❌ Broken | `/feed.xml`, `/rss.xml`, `/atom.xml` all 404 |
| robots.txt | ⚠️ Partial | Disallows /admin, /preview only; /login, /mcp, /api/, /oauth/ crawlable (login carries noindex, but belt-and-braces is better) |
| Discover readiness | ⚠️ Partial | `theme-color` present; no `max-image-preview:large`, no `og:image` |
| Image alt text | ❌ Broken | Cover, cards, thumbnails all `alt=""` — invisible to image search and screen readers |
| Image dimensions | ⚠️ | No width/height attributes (CSS aspect boxes limit CLS risk, but explicit dims are safer) |
| Web manifest | ❌ Broken | Root links `/__grok/manifest.webmanifest` → 404 |
| Favicon | ✅ Have | SVG favicon (media-overridable) + apple-touch-icon |
| noindex on private pages | ✅ Have | /login already `noindex`; admin behind auth + robots |
| 404 handling | ✅ Have | Proper 404 with a friendly page |
| HTTPS / HSTS-ish headers | ✅ Platform | Cloudflare HTTP/2 + H3; `x-content-type-options` on media |
| Media caching | ⚠️ Short | `/media/*` cached only 1 hour despite unique-per-upload ids |
| HTML payload | ✅ Good | Homepage ≈ 32 KB — light; Cloudflare edge-served |
| Author/byline (E-E-A-T) | ⚠️ Schema-only | Publisher "DYPOL Labs" exists in settings; no visible byline, no author in schema |
| Analytics | ❌ None | No privacy-friendly analytics wired (recommendation in §6) |
| Search Console / Bing | ❓ Unknown | Needs Rustam's accounts (§6) — verification can't be done from code alone |

---

## 4. What modern tech sites do (the full checklist, grouped)

**Technical:** absolute canonicals; XML sitemap with `lastmod`; news sitemap; robots.txt scoping; RSS/Atom feeds with discovery links; structured data (Article, BreadcrumbList, WebSite, Organization, ItemList); OG/Twitter cards with large images; `max-image-preview:large`; valid manifest + favicons + theme-color; noindex for admin/login/preview; real 404s; immutable caching for hashed/unique assets; image `alt` text and dimensions; HTTPS everywhere; single host + slash convention.

**On-page:** one clear H1; descriptive title ≤ ~60 chars and meta description ≤ ~155; visible date + author byline; topic filing (hub pages); related articles and "newer/older" navigation; descriptive anchor text; images near relevant text with captions/credits.

**Content/topic:** topic hubs that aggregate (our 25 topics), one article filed under every topic it genuinely fits (now supported), internal links between related stories, freshness (update `dateModified` when editing), no thin/duplicate pages, sources cited (the automation already appends a Sources section).

**Discover/News:** ≥1200 px 16:9 covers, article schema with image+dates+author, news sitemap, timely topics, no clickbait titles.

**Social:** OG/Twitter cards (done), share links (present), consistent site image for generic pages.

**Performance:** small HTML, edge CDN, lazy images (present), long cache for media/assets, minimal JS — largely inherent to this stack; measure with PageSpeed Insights after Search Console exists (field data needs traffic).

**Off-site (not code):** Search Console + sitemap submission, Bing Webmaster + IndexNow, Google News Publisher Center (optional), posting articles to relevant communities/newsletters, backlinks from roundups, social profiles pointing here, a custom domain (a memorable domain helps trust/sharing; `workers.dev` works but looks temporary).

---

## 5. Implemented in PR #18 (code-side, done)

Branch `t48-seo` from main (`ee37b35`). **Not merged.** No migration. No article text/titles/design changed.

| # | Change | Files |
|---|---|---|
| 1 | **RSS feed** `/feed.xml` (latest 20 published, categories, GUIDs) + `<link rel="alternate">` discovery in every page head | `src/routes/feed[.]xml.ts`, `src/routes/__root.tsx`, `repository.readFeed` |
| 2 | **Sitemap v2**: `<lastmod>` on every URL (articles: `updatedAt`; topics: newest article in topic; hubs likewise) | `src/routes/sitemap[.]xml.ts`, `repository.readSitemap` |
| 3 | **News sitemap** `/news-sitemap.xml` (last 48 h only, `news:` tags) + listed in robots.txt | `src/routes/news-sitemap[.]xml.ts` |
| 4 | **robots.txt**: also disallows `/login`, `/mcp`, `/api/`, `/oauth/`; both sitemaps listed | `src/routes/robots[.]txt.ts` |
| 5 | **OG/Twitter cards everywhere**: home, articles index, topics index, topic pages, about, articles (`og:type=article`, published/modified times, section, cover `og:image`, `summary_large_image`) | `src/lib/seo.ts` `socialMeta`, route `head()`s |
| 6 | **Absolute canonicals** on all public pages (origin taken from the actual request, so previews/local stay correct) | `public-api` loaders return `origin`; route heads |
| 7 | **Richer article schema**: `BlogPosting` → **`NewsArticle`** with image, author (Organization → /about), publisher+logo, `mainEntityOfPage`, `isAccessibleForFree`, topics as section/keywords | `src/lib/seo.ts` `articleJsonLd`, `articles/$slug` head |
| 8 | **BreadcrumbList** JSON-LD on article + topic pages (Home → Topics → Topic → Article) | route heads |
| 9 | **WebSite + Organization** `@graph` JSON-LD on the homepage | `src/routes/index.tsx` |
| 10 | **ItemList** JSON-LD on /articles and /topics | route heads |
| 11 | **Discover**: global robots meta gains `max-image-preview:large, max-snippet:-1, max-video-preview:-1`; article covers are the `og:image` | `__root.tsx` |
| 12 | **Broken manifest fixed**: own `/manifest.webmanifest` route (name, theme `#111111`, icons); root now links it (was a 404) | `src/routes/manifest[.]webmanifest.ts` |
| 13 | **Image alt text**: article covers, card thumbnails, sidebar and index thumbs now use the article title (was `alt=""` everywhere) | `cover.tsx`, `blocks.tsx`, `index-list.tsx` |
| 14 | **Visible byline**: "by DYPOL Labs" added to the article meta row (matches the schema author) | `article-view.tsx` |
| 15 | **Media caching**: `/media/*` → `public, max-age=31536000, immutable` (ids are unique per upload; was 1 h) | `src/routes/media/$id.ts` |
| 16 | **Automation guidance**: prompt doc now tells the AI its excerpt/`seo_description` become the search/social description and topics feed schema/feed categories | `docs/automation/automation-prompt.md` |

Also: pure builders isolated in `src/lib/seo.ts` (URL joining, XML escaping, RSS/sitemap/news-sitemap/JSON-LD/social meta) so everything is unit-tested without a server.

**Tests:** `npm run typecheck` clean · `npm run test:src` **147 pass, 0 fail** (7 new SEO builder tests: JSON-LD shape/validity, sitemap lastmod, 48 h news window, RSS escaping, social-meta rules) · new `npm run test:e2e:seo` **10/10 pass** locally (robots, both sitemaps, feed, manifest JSON, OG + parseable JSON-LD on home/article/topics, absolute canonical, non-empty alts, login noindex, immutable media cache) · `test:e2e:security` still all-pass (root head changed). Build passes.

**Deliberately not done in code:** global CSP/security-header middleware (high breakage risk against inline theme script + MCP; Cloudflare already adds transport security — noted for a future careful pass); image resizing pipeline (R2 covers are served as uploaded; the AI intake already enforces ≥400×200 — Discover's 1200 px guidance is an *authoring* note added to §6/roadmap); Atom duplicate of the RSS feed (one feed, discoverable, is enough); hreflang (single-language site).

---

## 6. What Rustam must do himself (accounts & off-site)

1. **Google Search Console** (biggest single lever — do first):
   1. Go to https://search.google.com/search-console → Add property → **URL prefix**: `https://dypolblog.rstmcsoch.workers.dev/`
   2. Verify: choose "HTML tag" — send me the `google-site-verification` code and I'll add the meta tag in a tiny PR; **or** verify instantly if the domain ever moves to a custom domain with DNS access.
   3. Then: Sitemaps → submit `sitemap.xml` and `news-sitemap.xml`; URL Inspection → test the homepage + one article → "Request indexing" for the 7 existing articles.
2. **Bing Webmaster Tools**: https://www.bing.com/webmasters → import from Search Console (one click after step 1) → submit both sitemaps. Optionally enable **IndexNow**: generate a key in Bing Webmaster → put the key file at `/<key>.txt` (I can add the file + auto-ping on publish in a follow-up PR once you give me the key).
3. **Analytics (free, privacy-friendly — pick one):** Cloudflare Dashboard → your zone/account → Analytics → **Web Analytics** → enable for the workers.dev site (no code change needed on Workers), or Plausible/Umami self-host later. This gives the traffic baseline the roadmap needs.
4. **Google News Publisher Center** (optional, later): https://publishercenter.google.com — submit the publication with the feed `https://dypolblog.rstmcsoch.workers.dev/feed.xml`. Eligibility isn't guaranteed; do it after a few weeks of steady publishing.
5. **Custom domain (recommended, when ready):** a real domain (e.g. `blog.dypol…` or similar) looks credible in search results and shares, and unlocks DNS-based verification. It's a Cloudflare route + domain purchase in your account; I can do the Worker side once the domain exists.
6. **Distribution basics:** post each new article where its audience already is (relevant subreddits/Discord/HN with genuine participation, X/LinkedIn), and ask to be included in tech-newsletter roundups. A handful of real backlinks outweighs any meta tag.
7. **Cover images for Discover:** when choosing/generating covers, prefer **≥1200 px wide, 16:9** images (the site already accepts up to 10 MB). The automation prompt can be told this too — say the word and I'll add it.

---

## 7. Priority roadmap

**Now (this PR + §6.1–6.3):** merge #18 when reviewed → apply nothing else (no migration) → Search Console verify + submit sitemaps + request indexing for the 7 articles → Bing import → Cloudflare Web Analytics on.

**Next (2–4 weeks of publishing):** watch Search Console (Coverage, Enhancements → Article rich results, Discover report if it appears); keep the automation's cadence steady; prefer 1200 px covers; check "Queries" for topics to double down on; add IndexNow if Bing matters.

**Later:** custom domain; Publisher Center; a careful security-headers pass; internal-linking review once the archive passes ~50 articles (orphan check via sitemap vs crawl); consider author pages if more writers join.

---

## 8. Expected impact (honest)

- **Immediately after merge + Search Console submission:** clean indexing of all pages, rich-result eligibility (Article), large-image Discover eligibility, working feed for readers/aggregators, proper share cards on every social/chat paste. These are *eligibility* unlocks — they remove reasons for Google to show the site poorly.
- **Rankings/traffic:** no honest person can promise movement. The compounding factors are publishing consistency, topic authority across the 25 hubs, and a few quality backlinks. The automation + topics work (PRs #14/#17) already covers the content side; this PR covers the technical side; §6 covers the authority side, which is now the bottleneck.
