# PageSpeed fixes (t88)

User supplied a mobile PageSpeed Insights report for
`https://blog.dypol.workers.dev/`. The unauthenticated PSI API
returned 429 (daily quota for the shared keyless consumer exhausted),
so the baseline below was measured with the same Lighthouse engine
locally against the **live** site (mobile emulation, devtools
throttling). Re-run PSI after deploy for the official numbers.

## Baseline (live, 2026-10-19 Asia/Calcutta)

| Page | Perf | A11y | Best practices | SEO | LCP | CLS | TBT | FCP | TTFB | Total bytes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Home (mobile) | 77 | 100 | 100 | 100 | 4.9 s | 0.001 | 0 ms | 2.4 s | 1,090 ms | 7,036 KiB |
| Home (desktop) | 99 | 100 | 100 | 100 | 0.5 s | 0.038 | 0 ms | 0.5 s | 880 ms | 7,255 KiB |
| Article (mobile) | 69 | 100 | 100 | 100 | 4.1 s | 0.278 | 0 ms | 2.3 s | 1,090 ms | 339 KiB |

## Top issues found, ranked

1. **Image delivery (biggest):** card/list/sidebar thumbnails served
   `/media/<id>` — the 1280px hero, and for legacy rows (no variants
   yet) the multi-MB original (one homepage image was 3.4 MB).
   Lighthouse estimated 3,343 KiB savings on the homepage alone.
2. **Homepage LCP lazy-loaded:** the featured cover — the LCP element —
   had `loading="lazy"` and no `fetchpriority`, so the browser deferred
   exactly the image that defines LCP. (Article covers already did this
   correctly.)
3. **Article CLS 0.278:** caused by the late-loading Familjen Grotesk
   webfont swapping in and shifting content (Lighthouse explicitly
   attributes the shift to the font file).
4. **No cache lifetime on hashed assets:** `/assets/*` (JS/CSS/fonts)
   were served `cache-control: public, max-age=0, must-revalidate`.
5. **Grain texture:** 43 KB PNG for a 128x128 tile; a lossless WebP of
   the same pixels is 27 KB.

## Fixes in this PR (no visual/layout changes)

- Homepage featured cover now uses `priority` (eager +
  `fetchpriority=high`), and both the homepage and article pages emit
  a `<link rel="preload" as="image">` for their hero/LCP image.
- All card, list-row, sidebar and index thumbnails now request
  `?variant=thumb` (480px, <=60 KB target) via the new pure helper
  `src/lib/media-url.ts`, and every content `<img>` carries explicit
  `width`/`height` + `decoding="async"` (CLS guards; CSS already fixed
  the displayed aspect ratios, so nothing moves visually).
- `public/_headers`: `/assets/*` -> `public, max-age=31536000,
  immutable` (filenames are content-hashed). Verified locally:
  wrangler parsed the rule and served the immutable header.
- The latin Familjen Grotesk woff2 (the font that sets header/headline
  metrics) is preloaded — same file the CSS already referenced, just
  delivered before first paint, removing the font-swap shift.
- `grain.png` -> lossless-identical `grain.webp` (43 KB -> 27 KB).
- Regression coverage: `src/lib/media-url.test.ts` (+2 tests, 207 total
  passing) and a new t88 check in `scripts/e2e/seo.e2e.mjs` (homepage
  hero eager/high-priority + preload, thumb variant usage, sized
  images). Responsive gate unchanged: 240 route x width combos, 0
  failing.

## Owner action needed for the full image gain

Thumbnails only shrink once a media row **has** variants. Most live
covers are still legacy rows whose `?variant=thumb` falls back to the
original. After this deploys: **Admin -> Media -> "Run backfill batch"**
until the reporter says 0 legacy images (see IMAGE-PIPELINE.md). New
uploads already get variants automatically.

## What cannot be fixed in code here

- **TTFB (~0.9-1.1 s):** the HTML is rendered per-request on Workers
  with D1 lookups; there is no safe static cache for signed/editor
  surfaces. This is the remaining LCP/FCP floor and an edge/data
  question, not a markup fix.
- **Field data:** Search Console Core Web Vitals is a 28-day rolling
  field dataset (CrUX). Even a perfect lab score will take weeks to
  move the GSC assessment; PageSpeed lab numbers update immediately
  on re-run after deploy.
- **Render-blocking CSS (~100-150 ms lab):** one 68 KB stylesheet
  (16 KB gzipped) carries the approved design; inlining/splitting it
  risks the visual design the owner has signed off, for ~0.1 s.

## Verification

- Live baseline above (Lighthouse, live site, before this branch).
- Local preview of this build: mobile Lighthouse homepage Performance
  99, CLS 0, LCP discovery checklist fully green, total page weight
  288 KiB (seed content) — directionally confirming the byte and CLS
  fixes; the honest post-deploy check is a fresh PSI run on the live
  URL once merged.
- `npm test` 207/207, `npm run typecheck` clean, build clean,
  `test:e2e:seo` ALL PASS, responsive gate 240/240.
