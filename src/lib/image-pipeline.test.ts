import assert from "node:assert/strict";
import test from "node:test";
import {
  HERO_SPEC,
  ImagePipelineError,
  THUMB_SPEC,
  fallbackProcessedImage,
  isQuotaError,
  plannedDimensions,
  probeImage,
  processImageBytes,
  type ImageTransformer,
} from "./image-pipeline.ts";
import { processUploadImage } from "./image-pipeline.server.ts";
import { createMediaStore, type MediaBucket, type MediaDatabase } from "../content/media-store.server.ts";

/** Minimal PNG with a real IHDR (probe reads offsets 16/20). */
function pngBytes(width: number, height: number, totalBytes = 33): Uint8Array {
  const bytes = new Uint8Array(Math.max(totalBytes, 33));
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function gifBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(10);
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0); // GIF89a
  const view = new DataView(bytes.buffer);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  return bytes;
}

test("plannedDimensions caps to the box and never upscales", () => {
  assert.deepEqual(plannedDimensions({ width: 2400, height: 1350 }, HERO_SPEC), { width: 1280, height: 720, resized: true });
  assert.deepEqual(plannedDimensions({ width: 800, height: 600 }, HERO_SPEC), { width: 800, height: 600, resized: false });
  assert.deepEqual(plannedDimensions({ width: 800, height: 600 }, THUMB_SPEC), { width: 480, height: 360, resized: true });
  assert.deepEqual(plannedDimensions({ width: 200, height: 100 }, THUMB_SPEC), { width: 200, height: 100, resized: false });
  // Tall image: height is the binding constraint.
  assert.deepEqual(plannedDimensions({ width: 600, height: 2400 }, HERO_SPEC), { width: 180, height: 720, resized: true });
});

test("probeImage reads PNG and GIF dimensions and rejects junk", () => {
  assert.deepEqual(probeImage(pngBytes(2400, 1350)), { format: "png", width: 2400, height: 1350, animated: false });
  assert.deepEqual(probeImage(gifBytes(320, 240)), { format: "gif", width: 320, height: 240, animated: true });
  assert.equal(probeImage(new Uint8Array([1, 2, 3, 4])), null);
});

test("processImageBytes produces hero+thumb WebP at spec qualities with anim preserved", async () => {
  const calls: { name: string; quality: number; anim: boolean; width: number }[] = [];
  const spy: ImageTransformer = async (input) => {
    calls.push({ name: input.spec.name, quality: input.quality, anim: input.anim, width: input.planned.width });
    return { bytes: new Uint8Array(100), contentType: "image/webp" };
  };
  const result = await processImageBytes(pngBytes(2400, 1350), spy);
  assert.equal(result.hero.width, 1280);
  assert.equal(result.hero.height, 720);
  assert.equal(result.thumb.width, 480);
  assert.equal(result.thumb.height, 270);
  assert.deepEqual(calls, [
    { name: "hero", quality: 82, anim: true, width: 1280 },
    { name: "thumb", quality: 78, anim: true, width: 480 },
  ]);
  assert.equal(result.transformCalls, 2);
  assert.deepEqual(result.warnings, []);
});

test("oversized variant output retries once at lower quality, then warns (soft target)", async () => {
  let heroCalls = 0;
  const transformer: ImageTransformer = async ({ spec }) => {
    if (spec.name === "hero") {
      heroCalls += 1;
      return { bytes: new Uint8Array(heroCalls === 1 ? 250_000 : 210_000), contentType: "image/webp" };
    }
    return { bytes: new Uint8Array(100), contentType: "image/webp" };
  };
  const result = await processImageBytes(pngBytes(2400, 1350), transformer);
  assert.equal(heroCalls, 2);
  assert.equal(result.hero.qualityUsed, HERO_SPEC.retryQuality);
  assert.equal(result.hero.overSoftTarget, true);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0] ?? "", /soft target/);
});

test("validation rejects junk, empty, >10MB and pixel bombs before any transform", async () => {
  let calls = 0;
  const counting: ImageTransformer = async () => {
    calls += 1;
    return { bytes: new Uint8Array(1), contentType: "image/webp" };
  };
  await assert.rejects(() => processImageBytes(new Uint8Array([9, 9, 9]), counting), (e: unknown) => e instanceof ImagePipelineError && e.code === "invalid-image");
  await assert.rejects(() => processImageBytes(new Uint8Array(0), counting), (e: unknown) => e instanceof ImagePipelineError && e.code === "invalid-image");
  await assert.rejects(
    () => processImageBytes(pngBytes(100, 100, 10_000_001), counting),
    (e: unknown) => e instanceof ImagePipelineError && e.code === "too-large",
  );
  await assert.rejects(
    () => processImageBytes(pngBytes(8000, 8000), counting),
    (e: unknown) => e instanceof ImagePipelineError && e.code === "too-large",
  );
  assert.equal(calls, 0);
});

test("non-WebP transform output is a hard failure, never stored", async () => {
  const bad: ImageTransformer = async () => ({ bytes: new Uint8Array(10), contentType: "image/png" });
  await assert.rejects(
    () => processImageBytes(pngBytes(800, 600), bad),
    (e: unknown) => e instanceof ImagePipelineError && e.code === "transform-failed",
  );
});

test("quota error 9422: small already-valid originals fall back explicitly, oversized are rejected", async () => {
  const quotaTransformer: ImageTransformer = async () => {
    throw new Error("error 9422: image transformation quota exceeded");
  };
  assert.equal(isQuotaError(new Error("9422")), true);
  assert.equal(isQuotaError(new Error("network down")), false);

  const small = await processUploadImage(pngBytes(800, 450, 5000), quotaTransformer);
  assert.equal(small.processing, "original-within-target");
  assert.equal(small.hero.contentType, "image/png");
  assert.match(small.warnings[0] ?? "", /transform unavailable/);

  await assert.rejects(
    () => processUploadImage(pngBytes(2400, 1350, 5000), quotaTransformer),
    (e: unknown) => e instanceof ImagePipelineError && e.code === "quota-exceeded",
  );
  // The pure fallback helper agrees: nothing oversized is ever stored.
  assert.equal(fallbackProcessedImage(pngBytes(2400, 1350, 5000), new ImagePipelineError("quota-exceeded", "x")), null);
});

test("GIF uploads keep the animation path (anim:true, WebP output)", async () => {
  const seen: boolean[] = [];
  const transformer: ImageTransformer = async (input) => {
    seen.push(input.anim);
    return { bytes: new Uint8Array(50), contentType: "image/webp" };
  };
  const result = await processImageBytes(gifBytes(480, 360), transformer);
  assert.equal(result.source.format, "gif");
  assert.deepEqual(seen, [true, true]);
});

/* ---- media store: variants, accounting, cleanup, legacy fallback ---- */

function fakeStore() {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const rows: Record<string, unknown>[] = [];
  const bucket: MediaBucket = {
    async put(key, bytes, contentType) {
      objects.set(key, { bytes, contentType });
    },
    async get(key) {
      return objects.get(key) ?? null;
    },
    async delete(key) {
      objects.delete(key);
    },
  };
  const db: MediaDatabase = {
    async all(sql, params = []) {
      if (sql.startsWith("select count")) {
        const stored = rows.reduce(
          (sum, r) => sum + (Number(r.hero_byte_size) || Number(r.byte_size)) + Number(r.thumb_byte_size ?? 0),
          0,
        );
        return [{ files: rows.length, bytes: stored, original_bytes: rows.reduce((s, r) => s + Number(r.byte_size), 0), variant_bytes: 0 }] as never;
      }
      if (sql.includes("hero_key is null")) return rows.filter((r) => !r.hero_key).slice(0, Number(params[0] ?? 10)) as never;
      if (sql.includes("where id = ?")) return rows.filter((r) => r.id === params[0]) as never;
      return [...rows] as never;
    },
    async run(sql, params = []) {
      if (sql.startsWith("insert into media") && params.length > 7) {
        rows.push({
          id: params[0], object_key: params[1], filename: params[2], mime: params[3], alt: params[4],
          byte_size: params[5], created_at: params[6], hero_key: params[7], thumb_key: params[8],
          hero_byte_size: params[9], thumb_byte_size: params[10], width: params[11], height: params[12], processing: params[13],
        });
        return;
      }
      if (sql.startsWith("insert")) {
        rows.push({ id: params[0], object_key: params[1], filename: params[2], mime: params[3], alt: params[4], byte_size: params[5], created_at: params[6] });
        return;
      }
      if (sql.startsWith("update media set hero_key")) {
        const row = rows.find((r) => r.id === params[7]);
        if (row && !row.hero_key) {
          row.hero_key = params[0]; row.thumb_key = params[1]; row.hero_byte_size = params[2];
          row.thumb_byte_size = params[3]; row.width = params[4]; row.height = params[5]; row.processing = params[6];
        }
        return;
      }
      if (sql.startsWith("delete")) {
        const index = rows.findIndex((r) => r.id === params[0]);
        if (index >= 0) rows.splice(index, 1);
      }
    },
  };
  return { objects, rows, store: createMediaStore(bucket, db) };
}

const processedId = "22222222-2222-4222-8222-222222222222";

test("putProcessed stores hero+thumb keys, read serves variants, stats include variants, remove deletes all", async () => {
  const { objects, rows, store } = fakeStore();
  await store.putProcessed({
    id: processedId,
    filename: "cover.png",
    mime: "image/png",
    alt: "Cover",
    originalByteSize: 900_000,
    hero: { bytes: new Uint8Array(120_000), contentType: "image/webp", width: 1280, height: 720 },
    thumb: { bytes: new Uint8Array(30_000), contentType: "image/webp" },
    processing: "images-binding",
    createdAt: "2026-10-18T00:00:00.000Z",
  });
  assert.ok(objects.has(`media/${processedId}/hero.webp`));
  assert.ok(objects.has(`media/${processedId}/thumb.webp`));
  assert.equal(rows[0]?.object_key, `media/${processedId}/hero.webp`);
  const hero = await store.read(processedId);
  assert.equal(hero?.mime, "image/webp");
  assert.equal(hero?.bytes.length, 120_000);
  const thumb = await store.read(processedId, "thumb");
  assert.equal(thumb?.bytes.length, 30_000);
  const stats = await store.storageStats();
  assert.equal(stats.files, 1);
  assert.equal(stats.storedBytes, 150_000);
  assert.equal(stats.originalBytes, 900_000);
  const items = await store.list();
  assert.equal(items[0]?.hasVariants, true);
  assert.equal(items[0]?.heroBytes, 120_000);
  assert.equal(await store.remove(processedId), true);
  assert.equal(objects.size, 0);
  assert.equal(rows.length, 0);
});

test("putProcessed cleans up every R2 object when the D1 insert fails", async () => {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const failingDb: MediaDatabase = {
    async all() {
      return [];
    },
    async run(sql) {
      if (sql.startsWith("insert")) throw new Error("d1 down");
    },
  };
  const bucket: MediaBucket = {
    async put(key, bytes, contentType) {
      objects.set(key, { bytes, contentType });
    },
    async get() {
      return null;
    },
    async delete(key) {
      objects.delete(key);
    },
  };
  const store = createMediaStore(bucket, failingDb);
  await assert.rejects(() =>
    store.putProcessed({
      id: processedId,
      filename: "x.png",
      mime: "image/png",
      alt: "",
      originalByteSize: 10,
      hero: { bytes: new Uint8Array(5), contentType: "image/webp", width: 10, height: 10 },
      thumb: { bytes: new Uint8Array(3), contentType: "image/webp" },
      processing: "images-binding",
      createdAt: "2026-10-18T00:00:00.000Z",
    }),
  );
  assert.equal(objects.size, 0);
});

test("legacy rows without variants still read (hero and thumb fall back to the original)", async () => {
  const { store } = fakeStore();
  await store.put({
    id: processedId,
    filename: "old.png",
    mime: "image/png",
    alt: "Old",
    bytes: pngBytes(64, 64),
    createdAt: "2026-10-01T00:00:00.000Z",
  });
  const hero = await store.read(processedId);
  assert.equal(hero?.mime, "image/png");
  const thumb = await store.read(processedId, "thumb");
  assert.deepEqual(thumb?.bytes, hero?.bytes);
  const items = await store.list();
  assert.equal(items[0]?.hasVariants, false);
  assert.equal(items[0]?.processing, "legacy");
});

test("backfill primitives: legacyBatch lists only variant-less rows; recordVariants is idempotent", async () => {
  const { objects, rows, store } = fakeStore();
  await store.put({
    id: processedId,
    filename: "old.png",
    mime: "image/png",
    alt: "Old",
    bytes: pngBytes(64, 64),
    createdAt: "2026-10-01T00:00:00.000Z",
  });
  const legacy = await store.legacyBatch(10);
  assert.equal(legacy.length, 1);
  const done = await store.recordVariants({
    id: processedId,
    hero: { bytes: new Uint8Array(100), contentType: "image/webp", width: 64, height: 64 },
    thumb: { bytes: new Uint8Array(40), contentType: "image/webp" },
    processing: "backfill-images-binding",
  });
  assert.equal(done, true);
  assert.ok(objects.has(`media/${processedId}/hero.webp`));
  assert.equal(rows[0]?.hero_byte_size, 100);
  // Second run: skipped, nothing overwritten.
  const again = await store.recordVariants({
    id: processedId,
    hero: { bytes: new Uint8Array(999), contentType: "image/webp", width: 64, height: 64 },
    thumb: null,
    processing: "backfill-images-binding",
  });
  assert.equal(again, false);
  assert.equal(rows[0]?.hero_byte_size, 100);
  assert.equal((await store.legacyBatch(10)).length, 0);
  const thumb = await store.read(processedId, "thumb");
  assert.equal(thumb?.bytes.length, 40);
});
