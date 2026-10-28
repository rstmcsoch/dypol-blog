# DYPOL BLOG — admin customisation audit, first implementation batch

Date: 28 October 2026. **Partial implementation; not ready to merge or deploy.**

This report distinguishes code inspection, local storage→HTML verification, and unperformed remote/browser checks. It does not certify section D of the supplied brief. No production settings, articles, media or pages were changed. No production deployment or remote migration was performed.

## 1. Design and system analysis (before editing)

Reviewed the public and admin components/styles separately, plus existing repository screenshots (`screenshots/home-day.png` and `screenshots/admin-dashboard-light.png`). These are repository reference images, not fresh screenshots of production. Live production browsing was unavailable under this environment's outbound network restrictions.

- **Public:** editorial typography, self-hosted Familjen Grotesk/Source Serif, large headlines, hard borders and offset shadows, accent bands, Day/Night CSS variables. Changes reuse those variables; the consent bar uses existing public buttons and border/shadow tokens.
- **Admin:** its own theme preferences, rounded cards, compact labelled fields, grouped sidebar, blue action styling. New controls reuse `block-card`, `field`, `check-row`, `filters`, and existing buttons. Public appearance is not applied to admin preferences.
- **Runtime:** existing React/TanStack Start application, Vite build, Cloudflare Workers adapter. No new framework or dependency introduced.
- **Storage:** D1 `articles`, article-topic/tag joins, `categories`, `tags`, `pages`, `media`, `site_settings`, revisions/activity, automation and analytics tables. `site_settings` row `id='site'` stores JSON, normalized/validated in `src/content/validate.ts`. R2 stores media objects, served through `/media/{id}`.
- **Reads:** `public-api.ts` server functions → `repository.server.ts` catalog/read helpers → public loaders/templates. Root `getShell()` supplies header, footer, theme and ticker settings. D1 failure falls back to bundled content; that fallback can mask a database problem and should be monitored.
- **Writes:** authenticated server functions in `admin-api.ts`, validated repository writes; `useSiteForm` saves the settings record and invalidates the current router. Existing saves replace the whole site JSON; cross-tab concurrent edits remain a risk, not resolved here.
- **Routes:** home, article archive/detail, topic index/detail, search, standard Pages/About; admin nested routes; feed, ordinary/news sitemaps, robots, manifest; contact/media/API routes; MCP/OAuth/preview. Author and tag detail routes requested in B are not implemented in this batch.
- **Existing migrations:** `0001`–`0020` under `migrations/d1`; authentication schema elsewhere. Existing redirects are article-slug redirects, not yet the general B11 path/status builder. Scheduling is still request-time sweeping; no Cron handler was added.

## 2. Verification vocabulary

- **Local checked:** persisted local D1 JSON was changed, public responses checked immediately without rebuild/redeploy, original JSON restored exactly in `finally`.
- **Code fixed:** validated/compiled/tested code path, but not all authenticated UI/browser cases verified.
- **Inspection only:** path mapped; no change/revert proof. This is NOT a “works” certification.
- Every control below still needs the full authenticated preview UI change/revert test before merge, even where local storage tests pass.

## 3. Section A wiring table

Settings unless stated otherwise are in `site_settings.data` at `id='site'`.

| Control | Storage | Public readers / expected places | Finding → work / evidence |
|---|---|---|---|
| Website name | `name` | catalog, shell, header/footer, homepage h1, standard-page kicker, metadata | **Hardcoded → fixed.** Removed overrides in both `catalog()` and `readShell()`. Local checked home/About. |
| Browser tab title | `title` | root/home head | **Hardcoded → fixed.** Local checked `<title>Wiring Preview Tab</title>`. Detail pages use their own title + saved site name. |
| Description | `description` | root/home meta, footer, manifest | Code reads saved description; local mutation included it. Not every meta reader asserted. |
| Publisher name | `publisher` | article JSON-LD/byline | **Article JSON-LD hardcoded → fixed**, publisher used for fallback Organization author; pure JSON-LD assertions pass. Byline rendering not browser verified. |
| X URL + Show | `socials[]` | `visibleSocials()` → footer | Empty/disabled/platform-root hidden; root warning added. Pure test, no authenticated toggle test. |
| Facebook URL + Show | `socials[]` | same | Same fix; individual network UI not verified. |
| Instagram URL + Show | `socials[]` | same | Same fix; pure empty-URL test. |
| YouTube URL + Show | `socials[]` | same | Same fix; pure disabled test. |
| LinkedIn URL + Show | `socials[]` | same | Same fix; individual network UI not verified. |
| RSS URL + Show | `socials[]` | same | Local path remains supported; pure test. |
| Email URL + Show | `socials[]` | same | Existing mailto validation retained; UI not verified. |
| AI daily publishing limit | `aiDailyPublishLimit` | automation/MCP publish-limit logic | Inspection only; existing limit tests pass. No remote publishing mutation. |
| Logo | `logoMediaId` | header; article publisher JSON-LD | Header already read selection; JSON-LD now reads selected media. If unset, article publisher logo is omitted rather than invented. |
| Favicon | `faviconMediaId` | root icon links, manifest | **Ignored → fixed in code.** Built-in icons only used when unset. Media/browser format suitability still needs validation. |
| Night darkness | `appearance.darkness` | `appearanceCss`, root theme-color | Code fixed metadata to use shared theme math; local setting mutation performed. |
| Day whiteness | `appearance.whiteness` | same + manifest background | Local checked manifest `#e6e6e6` after 90% selection. |
| Accent | `appearance.accent` | CSS; manifest theme color | Manifest now uses selection. Individual change/revert not executed. |
| Cover fallback simple/pattern/none | `appearance.coverFallback` | cover components | Inspection only; existing appearance tests retained. |
| Reset colours | admin Appearance reset to defaults | same readers | Inspection only; UI not executed. |
| Main menu labels/visible/order/topic shortcuts/add/remove | `nav[]` | header/NavLink | Inspection only; custom URLs not implemented. |
| Footer line | `footer.note` | footer | **`{year}` interpolation added**, typo-free new default; existing saved text not silently rewritten. Local checked dynamic year. |
| Footer links add/remove | `footer.links[]` | footer | **Stored but ignored → rendered**, local checked extra-link HTML. |
| Footer column headings/links | optional `footer.columns[]` | footer | **New builder** (see B2); local checked heading/link HTML. |
| About page text | legacy `about.paragraphs`; canonical `pages.body` | `/about` → Pages | **Duplicate editor → legacy copy preserved read-only**, link to Pages. Neither text deleted or overwritten. Owner comparison still required. |
| Homepage microcopy | `labels.*` | HomeBlocks | Most existing readers retained; all labels/reset buttons not individually exercised. |
| Article-page microcopy | `labels.*` | ArticleView, reading/share/sidebar components | Inspection only; all labels/reset buttons not exercised. |
| Archive/topic/empty-topic microcopy | `labels.*` | archive/topic/state components | Archive metadata now uses saved index title/intro; full UI tests pending. |
| Header/menu/theme/screen-reader labels | `labels.*` | header, theme toggle, state components | Homepage sr-only h1 fixed to site name. Other controls inspection only; hardcoded search/pagination text remains. |
| 404/error/loading/reset text | `labels.*` | states/error components | Inspection only; all reset controls not exercised. |
| Homepage all 15 block types | `home.blocks[]` | resolveBlocks → HomeBlocks | Inspection only; type-by-type enable/order/remove/count/layout/heading verification outstanding. |
| Sidebar all 9 block types + on/off | `articleSidebar` | articlePayload → sidebar blocks | Inspection only; type-by-type verification outstanding. |
| Homepage live preview = saved | draft site argument / saved JSON | preview/home vs public home | Inspection only; no equivalence proof yet. |
| Ticker show/label | `trending.enabled/label` | shell tickerEntries → TrendingBar | Inspection only. |
| Ticker newest/picked/most-read/own-text/count | `trending.source/slugs/customItems/count` | tickerEntries | Inspection only; existing tests retained. |
| Ticker display modes/seconds | `trending.mode/interval/speed` | TrendingBar | Inspection only. |
| Article title/excerpt/body/status/topic/image/motif | `articles` + joins | articlePayload/ArticleView | Inspection only; all editor fields not mutated. |
| Featured homepage | `articles.featured` | featured block resolver | Inspection only. |
| Article tags | tags + article-tag joins | editor, resolver | End-to-end tag creation/input/pages still outstanding. |
| Article fallback shape | motif | cover components | Inspection only. |
| Publication/future date | `published_at/scheduled_at` | request-time sweep/readers | Cron replacement outstanding. |
| Corrections note | `articles.corrections` | ArticleView | Inspection only. |
| SEO title/description | `seo_title/seo_description` | article head/socialMeta | Existing overrides retained; saved brand now drives suffix/site_name. No editor mutation proof. |
| History restore | revisions table / restore function | editor/readers | Inspection only; deliberately did not restore live content. |
| Topics label/slug/description/create/delete | `categories` + joins | topic routes/menu/cards/sitemaps/breadcrumbs | Inspection only; pin/order/SEO extras not implemented. |
| Tags label/slug/create/delete | `tags` + joins | blocks/editor | Full end-to-end wiring remains outstanding. |
| Pages create/edit/hide/slug | `pages` | readPage, readPageLinks, routes/sitemap/footer | Existing flow retained. Builder filters hidden standard-page links; custom-page visibility cases require follow-up. |
| Media alt + og:image:alt | `media.alt` / coverAlt | image and article social metadata | Inspection only. |
| In-use media deletion | media deletion server path | public references | Warning/block audit outstanding; no media deleted. |
| AI min words | publishing policy | server policy validation | Existing tests pass; no live run. |
| AI require sources + minimum sources | publishing policy | server policy validation | UI minimum disabled when requirement OFF, explanatory help added. Server enforcement not changed or newly certified. |
| AI require image/max per run/daily cap/allowed topics | policy/settings/profiles | automation/MCP | Inspection only; existing suite retained. No live AI calls. |

### Known-problem disposition

1. Hardcoded homepage h1/standard-page kicker: fixed.
2. Duplicate About text: public Pages retained; legacy editor read-only, content preserved.
3. Footer columns and unused footer link: builder added, saved links rendered.
4. Footer typo/year: new default uses `© {year}`; saved owner content untouched; year token rendered.
5. Article JSON-LD publisher/author/logo: settings wired. Person authors not implemented. `websiteJsonLd` now accepts optional selected logo while preserving bundled fallback for legacy callers.
6. GA/no consent: removed unconditional head scripts; GA field/toggle and public consent added. Six-month SameSite cookie; admin never mounts GA. Real browser accept/reject network test pending.
7. Manifest/metadata: generated from saved identity/appearance/favicon. Default OG Media selection added under Settings → Logo & icon. Remaining platform PWA helper defaults are outside this batch.
8. Tags: not fixed end-to-end.
9. Require sources UI: fixed; server rule behaviour still needs targeted live proof.
10. Turnstile: blocked on Cloudflare account/widget configuration access; no hostname/secret changes or fake submission claim.
11. Pagination: fixed isolated missing-page window, shared helper tested (`[1,2,3,4]` for four pages).
12. Sources: not implemented/backfilled; no content changed.
13. Search ranking/count/pagination: not implemented in this batch; existing FTS retained.
14. Cron scheduling: not implemented; request-time fallback retained.

## 4. Section B feature status

| Item | Delivered / location / proof or remaining work |
|---|---|
| B1 Authors | Not built. Needs additive schema, authenticated CRUD, editor association, public paginated route and Person JSON-LD. No fake author seeded. |
| B2 Footer builder | **Built (local partial verification).** Site text → Footer columns: heading; ordered links; internal/external href; new-tab; add/remove; column/link reorder; published-page suggestions. Legacy absence of `columns` uses the existing live-footer generator so migration is non-destructive. First edit captures those columns. Local HTML proves selected heading and link. Custom hidden-page edge cases and authenticated UI checks outstanding. |
| B3 Custom menu/manual popular topics | Not built. |
| B4 Social expansion/share networks | **Partial:** platform-root URL hiding and admin warning. New networks/share set not built. |
| B5 Topic pin/order/hide-empty/SEO | Not built; existing empty-topic hiding remains. |
| B6 SEO settings/Page SEO | **Partial:** Settings → Logo & icon → default social-sharing image selects Media; public route OG fallback reads it. Verification codes/robots append/Page noindex overrides not built. |
| B7 Analytics/consent | **Built, browser verification pending.** Settings → Analytics and consent (ID, enabled); Site text → Cookie consent (message). Existing public ID moved to central site defaults; runtime reads saved settings. Reject causes no GA request, accept is the only path that inserts the GA script by code inspection. Cookie lasts six months. Leaving public shell disables that GA instance. No actual browser network proof yet. Accept/Reject labels are not yet editable. |
| B8 Newsletter | Not built; no subscribers or external email service added. |
| B9 Messages/notification | Not built in this batch. Existing messages retained. |
| B10 Announcement | Not built. |
| B11 Redirects | General CRUD/status/cache/automatic page+topic redirects not built. Existing article redirects preserved. |
| B12 Appearance extras | **Partial:** manifest and root theme metadata use existing appearance math. New theme/font/secondary/base-size controls not built. |
| B13 Structured Sources | Not built. |
| B14 Manual curation | Not built. |
| B15 Pagination | **Partial:** existing archive/topic pager bug fixed; missing one page is shown instead of ellipsis. New configurable size, tag/author routes, sitemap policy not built. |
| B16 Full export | Not built. |
| B17 Security | **Partial:** HSTS added, HTML `Cache-Control: no-store` added; existing security headers retained. CSP deliberately not added without browser tests for inline hydration/theme, Turnstile, auth, embeds and preview framing. |

## 5. Tests, proof and release gate

Scripts committed under `tests/admin-wiring/`:

- `npm run test:admin-wiring`: **5/5 passing**. Settings JSON roundtrip/safety, pagination, placeholder social visibility, publisher/logo JSON-LD, source-level public identity and consent guards.
- `npm run test:admin-wiring:local`: **passed** on locally built Worker. Changes settings in LOCAL D1, then requests home/About/manifest with ordinary HTTP requests (no rebuild). Asserts saved name/title/footer links/columns/year, no initial GA script, no-store HTML, manifest name/background. Restores original local settings JSON exactly in `finally`. This bypasses admin forms; it is not a UI test or full browser-cache proof.
- `npm run typecheck`: passed.
- `npm run build`: passed. Final rebuild repeated after implementation.
- `npm run test:src`: **265/265 passing**. Fixed an existing wall-clock-sensitive analytics test to compare against `todayKolkata()` rather than 22 October.
- `npm run test:scripts`: **190 pass / 9 fail**. Ran the same script suite against an untouched `git archive HEAD` baseline: **identical 190/9**. Failures are eight platform PWA/OG plugin expectations plus a migration-plan assertion about the existing root `0002_blog.sql`. Not suppressed or relabelled as passing.
- `git diff --check`: passed after whitespace cleanup.
- `npm run check:auth`: could not read the Vite-only `/__app-env` endpoint from the built Wrangler preview. This is not an authentication-pass result; browser password + 2FA checks remain blocked.

Local built preview runs on the existing public routes. Vite dev initially failed during Worker export discovery; built Wrangler local preview succeeded. No Playwright browser executable is installed, and its download host is not allowed here, so fresh desktop/mobile screenshots, interactive admin verification, consent network testing, Lighthouse and accessibility measurements were not performed. Existing reference screenshots are not presented as new proof.

**Section D remains NOT PASSED.** No merge or production deploy is authorized by this report. Still required: every-control authenticated change/revert on remote preview; browser caching/SPA navigation; GA accept/reject; Lighthouse main comparison; external structured-data/RSS/sitemap validation; password + 2FA browser checks; live Turnstile → Messages; grep audit of platform PWA helpers and remaining non-editable microcopy/default footer definitions.

## 6. Migrations and data safety

No new D1 migration was necessary for this batch: additive settings properties are normalized in the existing JSON record. No existing schema/column renamed or dropped. No production migration/export attempted: `wrangler whoami` reports unauthenticated.

Local test database setup encountered an existing migration issue: `0008_pages.sql` self-inserts its name into `d1_migrations`, conflicting with Wrangler's own registration. After a local export to ignored `.wrangler/backups/before-preview-pages.sql`, applying that existing file directly locally and resuming remaining migrations succeeded. The original migration was not edited. This needs a separately reviewed remote migration plan; do not blindly run the local workaround on production.

The test database was initially empty when migrations were first applied; no production data was involved. Test-script mutations are restored in `finally`. Production backup before any future remote migration remains mandatory.

## 7. Owner must fill in / decide

- Real social profile URLs, not platform homepages (including requested future networks).
- Confirm whether existing GA ID `G-T1R0QJ2F0Z` belongs to this publication; it remains the initial value, not a newly invented ID. Disable analytics or clear it if not wanted.
- Google/Bing verification codes (fields not yet built).
- Real author name/slug/bio/avatar/social profiles and default author (feature not yet built).
- Owner contact-notification email and Cloudflare Email Routing binding configuration (not yet built).
- Turnstile widget allowed hostnames/sitekey/secret verification for production and preview; provide through account configuration, never chat credentials.
- Which About text to keep. **Both existing texts remain intact:** Site text shows the older paragraphs read-only; Pages → About Us controls public content. Live database text could not be retrieved for verbatim inclusion. Bundled older copy is two paragraphs: technology news/reviews published by DYPOL Labs; coverage of AI, smartphones, apps, cybersecurity, startups, gadgets and technology business. Bundled Pages text is the much longer About Us page in `src/content/pages-seed.ts` (coverage, production/sourcing promise, editorial/corrections links, publisher/contact). Compare actual saved versions in admin before editing; no automatic migration/discard occurred.
- Choose suitable default OG image, logo and favicon from Media; manifest install/icon dimensions still need browser validation.

### Content-only follow-up supplied in the brief (not independently live-verified)

Do not treat these counts as a fresh database audit:

- Placeholder socials.
- Seven empty topics: Buying Guides; Leaks; Online Scams; Product Reviews; Smart Mobility & Clean Technology; Social Media; Tech News.
- Three unused media files; nine legacy media files to optimise. Actual IDs require owner/database review; none deleted or recompressed.
- OpenAI provider selected with no key; empty AI automation run times. Configure via secrets/admin; no paid API calls made.
- About's sources promise versus old article source lists: structured sources/backfill remains work, not silently corrected content.

## 8. Skipped work and continuation

This is intentionally a first batch, not a claim that the multi-feature brief is complete. Missing B features require substantial schema/routing/editor work and their own regression checks. Cloudflare authentication, allowed outbound hosts and missing browser runtime prevent remote/live verification here. Retain this as a **draft PR** until the remaining work and all section D checks pass.

Work stays on the Arena-managed branch `arena/e2142fa8-dypol-blog`; the brief's suggested alternate branch name cannot be used in this session. No production deployment, purchase, external service signup or new dependency was made.
