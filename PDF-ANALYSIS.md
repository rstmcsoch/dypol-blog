# PDF Audit Analysis — DYPOL Blog (t58)

Source: "DYPOLBlog SEO, Traffic & AI Search Audit — 18 October 2026" (20 pages, OpenAI-generated research report).
Checked against: live site (curl, 18 Oct 2026 ~17:05 IST), prod D1 (read-only), repo `main` at 631d02d.
Statuses: ✅ Done · 🟡 Partially · ⬜ Not done · 🚫 Not applicable / will not do · 👤 Needs Rustam · 🔧 Done in PR for t58 (branch `t58-pdf-actions`, not merged).

Headline finding: the PDF is largely accurate and agrees with our own SEO-REPORT.md. Most of its P0/P1 technical items were already live; the genuinely new catches were the **robots/noindex conflict**, the **duplicate Worker hostname**, **hero-image lazy loading**, **stored image alt not being used**, **favicon-as-logo**, and **24 of 25 topic pages being empty yet indexable**. All six are fixed in the t58 PR. Everything else is editorial strategy or Rustam-side account work.

Also note: PR #21 (sidebar/loading) is in fact **merged** (631d02d), and this PDF's claim "SEO-REPORT.md is stale" is fixed in the same PR.

## Section 3 — Visual / UX opportunities
| # | Recommendation (PDF) | Status | Evidence / note |
|---|---|---|---|
| 3.1 | P1: clickable primary sources + author/editor accountability in article | 🟡 | Sources are listed at article end and Editorial/Corrections/Contact pages are live; no named human author exists to display (publisher byline "by DYPOL Labs"). Inline claim-level citations = automation-prompt improvement, editorial-side. |
| 3.2 | P1: descriptive alt text; preserve creator/license/source; visible credit | 🔧 | Media library already stored alt+credit (8/8 prod media have alt), but the site rendered the article *title* as alt. PR now renders the stored alt on hero/cards/sidebar/index (verified locally: alt="Concurrency test gradient"). Credit lines are appended to article bodies by the upload flow. |
| 3.3 | P1: hero image may be LCP — load eagerly + dimensions | 🔧 | Was `loading="lazy"` even in the hero. PR: hero gets `loading="eager" fetchPriority="high" width=1200 height=675`; cards stay lazy. |
| 3.4 | P2: archive search/filter when library grows | ⬜ | 7 articles — premature. Revisit at ~50+ articles. |
| 3.5 | P2: editor/author identity, methodology, dated policy pages | ✅ | Pages system live (About/Editorial/Corrections/Contact with dates, migration 0008 applied to prod). Named-person identity is Rustam's choice. |

## Section 5 — Technical SEO findings
| # | Finding / recommendation | Status | Evidence / note |
|---|---|---|---|
| 5.1 | Canonical URLs — one canonical host | 🔧 | PDF suspicion confirmed: **both** `dypolblog.` and `dypol-blog.rstmcsoch.workers.dev` serve the site (200). PR consolidates all workers.dev aliases/previews to `https://dypolblog.rstmcsoch.workers.dev` for canonicals/OG/JSON-LD/sitemaps/feed/robots; a future custom domain keeps its own origin (unit-tested). A 301 from the alias host is a Cloudflare-side rule (👤) — canonicals now do the consolidation job. |
| 5.2 | Sitemaps — verify counts/processing | 🟡 | Live `/sitemap.xml` 200 with lastmod; URL-count processing state is in Search Console (👤). PR removes 24 empty topic URLs from it. |
| 5.3 | News sitemap — 48h window, discovery aid only | ✅ | Live 200, valid News XML, 48h filter in code. |
| 5.4 | RSS feed — test in a reader | ✅ | Live 200 `application/rss+xml`, 7 items, valid (verified t49 + today). |
| 5.5 | OG/X cards — test with debuggers | 🟡 | Meta verified in served HTML; debugger screenshots need Rustam's logged-in tools (👤, 5 min). |
| 5.6 | Article structured data — validate live, match visible text | ✅ | NewsArticle+Breadcrumb JSON-LD parse on live articles (verified t49 + local e2e today). Rich Results Test itself is 👤. |
| 5.7 | Publisher logo — real brand asset, not favicon | 🔧 | Was `/favicon.svg`. PR adds `/logo.svg` brand wordmark and points Organization/NewsArticle logo at it (unit-tested). |
| 5.8 | Article hero loading (see 3.3) | 🔧 | Done in PR. |
| 5.9 | Image alt text (see 3.2) | 🔧 | Done in PR. |
| 5.10 | **robots/noindex conflict on /login (P0)** | 🔧 | Confirmed live: robots disallowed /login while the route emits noindex. PR removes the disallow (page stays behind sign-in; crawlers can now read the noindex) and updates the SEO e2e to assert exactly that. |
| 5.11 | Private URLs disallowed; auth is the real boundary | ✅ | /admin /preview /mcp /api/ /oauth/ disallowed; admin is token/session-gated (tested in prior e2e suites). |
| 5.12 | Web manifest — verify live JSON + icons | ✅ | Live 200 valid JSON; `/__grok/icon-180.png` returns 200 (checked t49). |
| 5.13 | Standard pages live + in footer/sitemap | ✅ | Verified live after 0008 was applied to prod (all 9 pages 200, footer links, sitemap). The PDF could not verify this; we could and did. |
| 5.14 | Homepage metadata must use live settings, not code fallbacks | 🔧 | Was true: `/` head used hardcoded fallback title/description. PR: homepage head now uses the stored site settings returned by its loader (unit/e2e green). |
| 5.15 | Analytics — no client analytics SDK; confirm baseline | 👤 | Correct: only anonymous per-article view counts + Worker metrics. Cloudflare Web Analytics needs Rustam to enable it and paste the token; Privacy Policy already says no trackers today, so adding one must update that page (Admin → Pages). |
| 5.16 | Repository hygiene — stale README, adminpanel.zip | 🟡 | README rewritten in PR (it described a Next.js starter). `adminpanel.zip` (4MB) inspected: a Grok scaffold snapshot (.grok refs, preview.log, skills) — no secrets seen, but removal is destructive/public-history, so 👤 decision; not removed in PR. |

## Section 6 — Cloudflare architecture checks
| # | Check | Status | Evidence / note |
|---|---|---|---|
| 6.1 | Confirm live commit/Worker/hostname | ✅ | Merges deploy via Workers Builds; latest main 631d02d (PR #21). Both Worker names serve the same code — see 5.1. |
| 6.2 | Worker metrics ≠ human pageviews | ✅ | Understood; we report view counts from `article_views`, not request totals. |
| 6.3 | WAF/Bot controls must not block Googlebot/OAI-SearchBot/Claude-SearchBot/Claude-User | 🟡 | robots.txt now expressly allows the three AI search agents (PR). Cloudflare Bot Fight Mode/WAF settings are account-side (👤 to eyeball once). |
| 6.4 | Caching/headers/HTTPS/content-type tests | ✅ | Media immutable 1y; feed/sitemaps short cache; HTML no-store by default. PR #21 already improved article loading (prefetch + parallel D1). |
| 6.5 | Privacy policy must describe actual collection | ✅ | Policy matches reality (anonymous counts, CF logs, editor cookie). Must be edited if analytics/ads are added (👤 trigger). |
| 6.6 | CI/deploy unverified | ✅ | Workers Builds on merge; no GitHub Actions in repo — deployments confirmed repeatedly (e.g. after #19/#21 merges). |

## Section 7 — Content, trust & topical authority
| # | Recommendation | Status | Evidence / note |
|---|---|---|---|
| 7.1 | Concentrate on 3–5 clusters before spreading across 25 topics | 🟡 | Data is starker than the PDF knew: **all 7 prod articles are filed under Artificial Intelligence & AI Tools; 24 topics are empty.** De-facto cluster #1 exists. Choosing clusters 2–3 is an editorial decision (👤/prompt-side); the automation prompt can be pointed at them. |
| 7.2 | Each article must add value beyond the announcement (comparison/evidence/consequence) | 🟡 | Automation prompt already demands primary sources, ≥2-source verification, why-it-matters; enforcement is editorial review (👤 workflow), plus prompt wording can be tightened on request. |
| 7.3 | Claim-level inline source links, primary first | ⬜ | Articles list sources at the end; inline citations not yet standard. Prompt-side change (can do on request). |
| 7.4 | Honest dates; dateModified only on material change | ✅ | Schema/UI show published + updated; automation does not fake dates. |
| 7.5 | Reviews must state method/limits; never invent tests/quotes/stats | ✅ | Editorial Policy + Disclaimer pages live with exactly this. |
| 7.6 | Keep trust pages visible & accurate | ✅ | Live and footer-linked (0008 applied). |
| 7.7 | Human editor checks facts/sources/rights/title pre-publish | 🟡 | Promised on About/Editorial pages and supported by admin review; whether it happens per-article is Rustam's workflow (👤). |
| 7.8 | AI position: assistance + human approval, not mass rewrites | ✅ | Exactly the stated model on the Editorial page; automation caps exist in publishing policy. |

## Section 8 — On-page SEO & article format
| # | Element | Status | Evidence / note |
|---|---|---|---|
| 8.1 | Title/H1 — front-load entity, no stuffing | ✅ | Per-article seoTitle supported + used by automation. |
| 8.2 | Description/excerpt specific | ✅ | seoDescription supported; route uses it before excerpt. |
| 8.3 | Lede answers the headline fast | 🟡 | Template puts excerpt as lede; content habit is prompt/editorial (👤). |
| 8.4 | Descriptive H2s | 🟡 | Body blocks support headings; habit is prompt-side. |
| 8.5 | Internal linking beyond related modules; orphan audit | 🟡 | Topics/kicker/prev-next/related exist; with 7 articles there are no orphans (all in index + AI hub). Pillar-linking arrives with clusters (7.1). |
| 8.6 | Byline/dates — real author profile eventually | 🟡 | Publisher byline today; named author is 👤 identity decision. |
| 8.7 | Sources/evidence (see 7.3) | ⬜ | As above. |
| 8.8 | Images ≥1200px wide, 16:9, multiple schema sizes | 🟡 | Covers are 16:9-cropped in UI; hero now declares 1200×675. Actual uploaded pixel sizes vary (automation generates/uploads); schema ships the one cover URL. Resizing pipeline = future work. |
| 8.9 | Sparse taxonomy; don't index empty/near-identical hubs | 🔧 | PR: empty topic pages get `noindex, follow` and leave the sitemap until they have a story (24 prod topics affected). |
| 8.10 | Schema is not a ranking shortcut | ✅ | Agreed; no schema spam added. |
| 8.11 | Recommended article structure (8 steps) | 🟡 | Mostly mirrors the automation prompt already; can be pasted into the prompt verbatim on request. |

## Section 9 — AI search (ChatGPT / Claude / Gemini / Grok)
| # | Recommendation | Status | Evidence / note |
|---|---|---|---|
| 9.1 | Keep OAI-SearchBot unblocked; track `utm_source=chatgpt.com` | 🔧/👤 | Robots now expressly allows OAI-SearchBot. Referral tracking needs analytics (5.15, 👤). |
| 9.2 | Don't blanket-block Claude-SearchBot / Claude-User | 🔧 | Expressly allowed in PR robots. |
| 9.3 | GPTBot / ClaudeBot (training) — separate owner decision | 👤 | Left under the wildcard Allow (status quo). Rustam: say the word and I'll add explicit Disallow/Allow lines — it's a licensing preference, not an SEO lever. |
| 9.4 | Gemini/AI Overviews = normal SEO + index/snippet eligibility | ✅ | index,follow + max-image-preview:large already global. Google-Extended left untouched deliberately (not a ranking switch). |
| 9.5 | Grok/xAI — don't invent crawler rules | ✅ | No fake user-agent rules added — exactly as the PDF advises. |
| 9.6 | No llms.txt / "AI schema" / citation-bait files | 🚫 | Will not do — PDF itself says Google needs no AI-specific files; agreed. |

## Section 10 — Traffic growth plan
| # | Phase item | Status | Evidence / note |
|---|---|---|---|
| 10.1 | A: verify live deployment vs main | ✅ | Done repeatedly; latest main verified live today (endpoints, pages, schema). |
| 10.2 | A: Search Console URL Inspection (home, index, topics, 3–5 articles) | 👤 | Needs Rustam's GSC account; sitemap already submitted per his earlier confirmation. |
| 10.3 | A: sitemap report review (not resubmission) | 👤 | GSC-side. |
| 10.4 | A: fix /login contradiction | 🔧 | Done in PR. |
| 10.5 | A: validate markup in Rich Results/Schema validators | 👤 | Served JSON-LD parses (verified by us); the Google tools need his account/session. |
| 10.6 | A: analytics baseline | 👤 | See 5.15. |
| 10.7 | B: choose 3 clusters + 1 pillar each + link news→pillar | 👤/🟡 | Editorial choice; AI cluster already dominant (7/7). I can draft pillar outlines on request. |
| 10.8 | B: recurring named formats ("AI Chip Watch" etc.) | ⬜ | Content-side; can be encoded in the automation prompt on request. |
| 10.9 | B: per-publish distribution checklist (community/social/newsletter) | 👤 | Rustam's accounts; no spam submissions (agreed, 🚫 for link drops). |
| 10.10 | B: Bing Webmaster + IndexNow | 👤 | Needs his Bing account + an IndexNow key he generates; I can wire the ping-on-publish code once a key exists. |
| 10.11 | C: GSC query-driven improvements after 30–90 days | 👤 | Needs GSC data. |
| 10.12 | C: one linkable asset/month (benchmark, timeline, data, tool) | ⬜ | Content project; can build data/tool pages on request. |
| 10.13 | C: owned return channel (newsletter/social/RSS) | 🟡 | RSS live; newsletter/social are 👤 accounts. |
| 10.14 | C: prune/merge only genuinely thin duplicates | ✅ | Agreed — nothing pruned; empty topics now noindexed instead (8.9). |
| 10.15 | C: custom domain when ready | 👤 | Domain purchase + Cloudflare setup; canonical code already handles a future custom domain (5.1). |
| 10.16 | Content mix 35–45% news / 35–45% evergreen / 15–25% original | 🟡 | Editorial planning heuristic; current archive is 100% news-style AI pieces. |

## Section 11 — Measurement dashboard
All seven questions (indexation, search performance, cluster demand, Discover, AI referrals, Core Web Vitals, Worker stability, links) are 👤 account-side reviews (GSC, analytics, PageSpeed, Cloudflare dashboard) on the PDF's weekly/monthly cadence. Nothing code-side blocks them; our anonymous view counter covers "which articles get read" at a basic level. I can re-run the technical half (live endpoints, schema, CWV lab scores via local Lighthouse-style checks) any time.

## Section 12 — Prioritized backlog (PDF's own ranking)
| Rank | Action | Status |
|---|---|---|
| P0 | Verify live Worker = main; canonical hostname | ✅ verified; canonical 🔧 in PR (+ 👤 optional alias redirect rule) |
| P0 | Resolve /login robots+noindex conflict | 🔧 in PR |
| P0 | GSC URL-level inspection + sitemap processing | 👤 |
| P1 | Validate live JSON-LD + social tags | ✅ served output valid; 👤 for Google's tools |
| P1 | Visitor analytics + privacy accuracy | 👤 |
| P1 | Cover image delivery & semantics | 🔧 in PR |
| P1 | 3–5 topic clusters | 👤/🟡 (AI cluster de facto) |
| P1 | Auditable human edit/source/corrections workflow | 🟡 (system supports; habit is 👤) |
| P2 | Legit mentions/links + return channel | 👤 |
| P2 | Standard pages seeded & visible | ✅ done + verified live |
| P2 | Crawler policy review (OpenAI/Anthropic/Google + CF bots) | 🔧 robots in PR; 👤 CF dashboard glance |
| P3 | README + zip hygiene | 🔧 README in PR; zip 👤 |
| P3 | Custom domain + author pages | 👤 |

## "What not to spend time on" (PDF §12) — agreed, will not do 🚫
Repeated sitemap resubmission · extra schema types for their own sake · keyword-chasing near-duplicate pages/tags · mass AI summary publishing · **bought backlinks, fake comments, forum/Reddit/Discord spam** · llms.txt/"AI badges" to force citations. None were done; none will be.

## Counts
- Checklist items extracted: **52**
- ✅ Already done/verified: **19**
- 🔧 Implemented in the t58 PR: **9** (robots/login, AI-search crawler groups, canonical consolidation, empty-topic noindex+sitemap, stored cover alt everywhere, hero eager/priority, publisher logo, homepage live metadata, README/SEO-REPORT freshness)
- 🟡 Partially / in-progress by design: **12**
- ⬜ Not done yet (future/content-side): **5**
- 👤 Needs Rustam (accounts/editorial/legal-identity): **13** (several overlap with 🟡)
- 🚫 Will not do: the 6 tactics above (counted once as a group)

## Top next actions (ranked)
1. 👤 Merge the t58 PR, then glance at GSC: URL Inspection for /, /articles, /topics + 3 articles; note Google-selected canonicals.
2. 👤 Decide training-bot policy (GPTBot/ClaudeBot) — one line in robots either way, I'll add it.
3. 👤 Enable Cloudflare Web Analytics (or say no) — if yes, update the Privacy Policy page in Admin → Pages the same day.
4. 👤 Pick clusters 2–3 next to AI (chips/cloud and cybersecurity are the natural neighbours of the current archive); I'll encode them + one pillar outline each in the automation prompt.
5. 👤 Optional: Cloudflare redirect rule `dypol-blog.` → `dypolblog.` host (canonicals already consolidate; the redirect makes it airtight).
