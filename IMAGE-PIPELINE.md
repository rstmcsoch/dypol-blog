# Image pipeline (t60)

Every image uploaded to DYPOL Blog — admin manual upload, MCP
`upload_featured_image` (base64 **and** URL fetch), and the legacy
backfill — goes through one service: `processUploadImage` in
`src/lib/image-pipeline.server.ts`, built on the pure, unit-tested
logic in `src/lib/image-pipeline.ts`.

## Variants

| Variant | Box (never upscaled) | Format | Quality | Soft byte target |
| --- | --- | --- | --- | --- |
| hero | 1280×720 | WebP | 82 (retry 70) | ≤ 200 KB |
| thumb | 480×360 | WebP | 78 (retry 64) | ≤ 60 KB |

- Processing happens **once at upload**. Variants are stored in R2 as
  `media/<id>/hero.webp` and `media/<id>/thumb.webp`; the `media` row
  (migration `0009_media_variants.sql`) records both keys, byte sizes,
  dimensions and how the image was processed.
- `/media/<id>` serves the hero; `/media/<id>?variant=thumb` serves
  the thumb. Rows uploaded before the pipeline (no variants) fall back
  to the original object for both — nothing breaks for legacy media.
- If a variant still exceeds its soft target after the quality retry,
  it is stored with an explicit warning (recorded in the upload
  result), never silently.
- Animation and transparency are preserved: the transformer is always
  called with `anim: true` and WebP output (GIF/WebP animation and
  alpha survive). Non-WebP transform output is a hard failure.

## Why the Cloudflare IMAGES binding

Verified against Cloudflare documentation (2026-10-18):

- `env.IMAGES.input(stream).transform({ width, height, fit:
  "scale-down" }).output({ format: "image/webp", quality, anim })`
  is the documented Workers image-transformation API; it accepts raw
  bytes/streams up to 20 MB. `.info()` is free.
- Workers run in V8 isolates (128 MB memory); native decoders such as
  Sharp are not a documented/supported Worker dependency, and decoding
  multi-MP images in-isolate would also burn the CPU budget. Client-side
  resizing was rejected because it cannot cover the server-side
  automation URL-fetch path. The binding covers **all** paths.
- Free plan includes **5,000 unique transformations/month**; past that,
  **new** transformations fail with error 9422 while already-stored
  media keep serving. We spend quota only at upload/backfill time
  (2 transforms per image, plus rare retries).

## Failure behaviour (explicit, never silent)

- Invalid/oversized input (not JPEG/PNG/WebP/GIF by magic bytes,
  unreadable dimensions, >10 MB, >50 MP, >12000 px on an edge) is
  rejected before any transform. Existing SSRF guards on the URL-fetch
  path are unchanged.
- Transform failure (binding missing, quota 9422, encoder error):
  - If the original **already fits** 1280×720 and 200 KB, it is stored
    as-is, recorded as `processing = 'original-within-target'` with a
    visible warning. Nothing oversized is ever stored this way.
  - Otherwise the upload fails with a clear, code-tagged error
    (`quota-exceeded` returns HTTP 503 with guidance).
- R2 objects are written before the D1 row; any failure deletes every
  object written for that upload. No partial media remains.

## Storage accounting

`media` rows keep the original `byte_size` and add `hero_byte_size` /
`thumb_byte_size`. `storageStats()` reports files, bytes actually
stored (hero-or-legacy + thumb), original bytes, and variant bytes.
Admin → Media shows per-image original/hero/thumb sizes and flags
legacy files that still need backfilling.

## Legacy backfill

- `node scripts/backfill-image-variants.mjs [--remote]` — dry-run
  reporter (reads D1 via wrangler, writes nothing).
- Apply from **Admin → Media → “Run backfill batch”**
  (`adminBackfillMedia` → `backfillMediaVariants`): bounded batches
  (default 10, max 25), idempotent (rows with variants are skipped),
  per-item failure reporting, stops early on quota errors. Variants are
  produced by the same Worker pipeline — not a local encoder — so
  backfilled media is identical in spec to fresh uploads.

## Deploy checklist (owner)

1. Apply migration 0009 to prod D1 (`wrangler d1 migrations apply DB
   --remote` or the usual reviewed SQL path).
2. Merge the PR; Workers Builds deploys both Workers. `wrangler.jsonc`
   now declares the `images` binding (`IMAGES`) for both — no dashboard
   action is needed, but confirm the binding appears under
   Workers → dypolblog → Settings → Bindings after deploy.
3. Upload one test image in Admin → Media; confirm hero/thumb sizes.
4. Run the backfill batches until the preview reports 0 legacy images.
5. Watch the Images quota in the Cloudflare dashboard (Media →
   Images → Usage) during backfill; 8 legacy prod images ≈ 16
   transforms — far under the free 5,000/month.

## Measured results (local fixtures, PIL/libwebp proxy encoder)

Generated photo-like fixtures (`scripts/measure-image-pipeline.py`)
and also verified end-to-end against the real local IMAGES binding:

| Fixture | Original | Hero | Thumb |
| --- | --- | --- | --- |
| 2400×1350 JPEG | 673 KB | 1280×720, 67 KB | 480×270, 7 KB |
| 1920×1080 PNG | 2168 KB | 1280×720, 74 KB (real binding: 64 KB) | 480×270, 8 KB (real: 9 KB) |
| 800×450 JPEG | 84 KB | 800×450 (no upscale), 32 KB | 480×270, 12 KB |

Average hero ≈ 58 KB, thumb ≈ 9 KB — far under the soft targets;
≈ 67 KB stored per article vs ≈ 975 KB for originals alone.
