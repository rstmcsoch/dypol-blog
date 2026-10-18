/**
 * Image optimization pipeline — pure logic (t60).
 *
 * Every upload path (admin manual upload, MCP upload_featured_image via
 * base64 or URL fetch) funnels through `processImage` in
 * image-pipeline.server.ts, which uses this module for validation and
 * variant planning. The actual pixel work is done by the Cloudflare
 * IMAGES binding (documented Workers binding; Sharp/native decoders do
 * not run in the Workers isolate). This module stays binding-free so it
 * is fully unit-testable with a mock transformer.
 *
 * Contract (verified against Cloudflare docs, 2026-10-18):
 *  - Hero:  WebP, max box 1280x720, quality 82, soft target <= 200 KB.
 *  - Thumb: WebP, max box 480x360,  quality 78, soft target <= 60 KB.
 *  - Never upscale (fit: "scale-down" semantics in the transformer;
 *    the planned dimensions computed here also never exceed the source).
 *  - Process once at upload; variants are stored in R2 and served
 *    directly afterwards (no per-request transforms, so the Images
 *    free quota — 5,000 unique transformations/month, then error
 *    9422 — is only spent at upload/backfill time).
 *  - Animation/transparency are never silently dropped: the
 *    transformer is always called with `anim: true` and WebP output,
 *    which preserves GIF/WebP animation and alpha.
 */

export type VariantSpec = {
  name: "hero" | "thumb";
  maxWidth: number;
  maxHeight: number;
  quality: number;
  softMaxBytes: number;
  retryQuality: number;
};
export const HERO_SPEC: VariantSpec = { name: "hero", maxWidth: 1280, maxHeight: 720, quality: 82, softMaxBytes: 200_000, retryQuality: 70 };
export const THUMB_SPEC: VariantSpec = { name: "thumb", maxWidth: 480, maxHeight: 360, quality: 78, softMaxBytes: 60_000, retryQuality: 64 };

/** Hard input limits (the existing 10 MB upload cap is unchanged). */
export const MAX_IMAGE_BYTES = 10_000_000;
/** Decode-bomb guard: refuse absurd pixel counts before any transform. */
export const MAX_IMAGE_PIXELS = 50_000_000;
export const MAX_IMAGE_DIMENSION = 12_000;

export type ImagePipelineErrorCode = "invalid-image" | "too-large" | "transform-failed" | "quota-exceeded" | "binding-missing";

export class ImagePipelineError extends Error {
  code: ImagePipelineErrorCode;
  constructor(code: ImagePipelineErrorCode, message: string) {
    super(message);
    this.name = "ImagePipelineError";
    this.code = code;
  }
}

export type SourceImageInfo = { format: "jpeg" | "png" | "webp" | "gif"; width: number; height: number; animated: boolean };

/** Magic-byte sniffing, incl. GIF (the admin path accepts GIF). */
export function sniffImageFormat(bytes: Uint8Array): SourceImageInfo["format"] | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "webp";
  if (bytes.length >= 6 && (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a")) return "gif";
  return null;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = "";
  for (let i = start; i < start + length && i < bytes.length; i += 1) out += String.fromCharCode(bytes[i] ?? 0);
  return out;
}

function u16le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

/**
 * Header-only dimension probe for JPEG/PNG/WebP/GIF. Returns null when
 * the dimensions cannot be read from the header (caller treats that as
 * an invalid image for cover use). WebP animation flag is read from
 * VP8X; GIF animation is assumed possible and handled with anim:true.
 */
export function probeImage(bytes: Uint8Array): SourceImageInfo | null {
  const format = sniffImageFormat(bytes);
  if (!format) return null;
  try {
    if (format === "png") {
      if (bytes.length < 24) return null;
      const width = readU32(bytes, 16);
      const height = readU32(bytes, 20);
      return sane({ format, width, height, animated: false });
    }
    if (format === "gif") {
      if (bytes.length < 10) return null;
      return sane({ format, width: u16le(bytes, 6), height: u16le(bytes, 8), animated: true });
    }
    if (format === "webp") {
      const dims = webpDimensions(bytes);
      if (!dims) return null;
      const animated = bytes.length > 21 && ascii(bytes, 12, 4) === "VP8X" && ((bytes[20] ?? 0) & 0x02) !== 0;
      return sane({ format, width: dims.width, height: dims.height, animated });
    }
    const dims = jpegDimensions(bytes);
    if (!dims) return null;
    return sane({ format, width: dims.width, height: dims.height, animated: false });
  } catch {
    return null;
  }
}

function sane(info: SourceImageInfo): SourceImageInfo | null {
  if (!Number.isFinite(info.width) || !Number.isFinite(info.height)) return null;
  if (info.width < 1 || info.height < 1) return null;
  if (info.width > MAX_IMAGE_DIMENSION || info.height > MAX_IMAGE_DIMENSION) return null;
  return info;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] ?? 0) << 24) | ((bytes[offset + 1] ?? 0) << 16) | ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0)) >>> 0;
}

function webpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 30) return null;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8X") {
    const width = 1 + ((bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16));
    const height = 1 + ((bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16));
    return { width, height };
  }
  if (chunk === "VP8 ") {
    if (bytes.length < 30) return null;
    const w = (bytes[26] ?? 0) | ((bytes[27] ?? 0) << 8);
    const h = (bytes[28] ?? 0) | ((bytes[29] ?? 0) << 8);
    return { width: w & 0x3fff, height: h & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (bytes.length < 25) return null;
    const b0 = bytes[21] ?? 0;
    const b1 = bytes[22] ?? 0;
    const b2 = bytes[23] ?? 0;
    const b3 = bytes[24] ?? 0;
    return { width: 1 + (b0 | ((b1 & 0x3f) << 8)), height: 1 + (((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10))) };
  }
  return null;
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1] ?? 0;
    const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
    if (length < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0);
      const width = ((bytes[offset + 7] ?? 0) << 8) | (bytes[offset + 8] ?? 0);
      return { width, height };
    }
    offset += 2 + length;
  }
  return null;
}

/** Fit `source` inside the spec box without ever upscaling. */
export function plannedDimensions(source: { width: number; height: number }, spec: VariantSpec): { width: number; height: number; resized: boolean } {
  const scale = Math.min(1, spec.maxWidth / source.width, spec.maxHeight / source.height);
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
    resized: scale < 1,
  };
}

/** A transform function: Cloudflare IMAGES in production, a mock in tests. */
export type ImageTransformer = (input: {
  bytes: Uint8Array;
  spec: VariantSpec;
  quality: number;
  /** Always true from this pipeline: preserve animation + alpha. */
  anim: true;
  planned: { width: number; height: number };
}) => Promise<{ bytes: Uint8Array; contentType: string }>;

export type ProcessedVariant = {
  spec: VariantSpec;
  bytes: Uint8Array;
  contentType: "image/webp";
  width: number;
  height: number;
  qualityUsed: number;
  overSoftTarget: boolean;
  transformCalls: number;
};

export type ProcessedImage = {
  source: SourceImageInfo;
  hero: ProcessedVariant;
  thumb: ProcessedVariant;
  /** e.g. "hero over 200 KB soft target at 1845x1038 source" — never silent. */
  warnings: string[];
  transformCalls: number;
};

async function runVariant(
  bytes: Uint8Array,
  source: SourceImageInfo,
  spec: VariantSpec,
  transform: ImageTransformer,
  warnings: string[],
): Promise<ProcessedVariant> {
  const planned = plannedDimensions(source, spec);
  let result = await transform({ bytes, spec, quality: spec.quality, anim: true, planned });
  let qualityUsed = spec.quality;
  let calls = 1;
  assertWebp(result, spec);
  if (result.bytes.length > spec.softMaxBytes) {
    // One documented retry at a lower quality; still over = accept with
    // an explicit warning (soft target), recorded by the caller.
    const retry = await transform({ bytes, spec, quality: spec.retryQuality, anim: true, planned });
    calls += 1;
    assertWebp(retry, spec);
    if (retry.bytes.length < result.bytes.length) {
      result = retry;
      qualityUsed = spec.retryQuality;
    }
  }
  const overSoftTarget = result.bytes.length > spec.softMaxBytes;
  if (overSoftTarget) {
    warnings.push(`${spec.name} is ${result.bytes.length} bytes, over the ${spec.softMaxBytes}-byte soft target after quality retry`);
  }
  return { spec, bytes: result.bytes, contentType: "image/webp", width: planned.width, height: planned.height, qualityUsed, overSoftTarget, transformCalls: calls };
}

function assertWebp(result: { bytes: Uint8Array; contentType: string }, spec: VariantSpec): void {
  if (!result || result.bytes.length === 0) {
    throw new ImagePipelineError("transform-failed", `Image transform returned no data for the ${spec.name} variant.`);
  }
  if (!result.contentType.toLowerCase().startsWith("image/webp")) {
    throw new ImagePipelineError("transform-failed", `Image transform returned ${result.contentType || "unknown type"} for the ${spec.name} variant, expected WebP.`);
  }
}

/**
 * Validate + produce both variants. Throws ImagePipelineError with a
 * stable code on any failure; nothing is stored by this function, so a
 * throw here can never leave partial media behind.
 */
export async function processImageBytes(bytes: Uint8Array, transform: ImageTransformer): Promise<ProcessedImage> {
  if (bytes.length === 0) throw new ImagePipelineError("invalid-image", "Image is empty.");
  if (bytes.length > MAX_IMAGE_BYTES) throw new ImagePipelineError("too-large", "Image must be under 10 MB.");
  const source = probeImage(bytes);
  if (!source) {
    throw new ImagePipelineError("invalid-image", "That file is not a readable JPEG, PNG, WebP or GIF image, or its dimensions could not be read.");
  }
  if (source.width * source.height > MAX_IMAGE_PIXELS) {
    throw new ImagePipelineError("too-large", `Image is ${source.width}x${source.height} (${source.width * source.height} pixels), over the ${MAX_IMAGE_PIXELS}-pixel safety limit.`);
  }
  const warnings: string[] = [];
  const hero = await runVariant(bytes, source, HERO_SPEC, transform, warnings);
  const thumb = await runVariant(bytes, source, THUMB_SPEC, transform, warnings);
  return { source, hero, thumb, warnings, transformCalls: hero.transformCalls + thumb.transformCalls };
}

/** True when a transform failure is the Images free-quota error 9422. */
export function isQuotaError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
  return /9422|quota|unique transformations/i.test(text);
}

const FORMAT_MIME: Record<SourceImageInfo["format"], string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

/**
 * Honest fallback, used ONLY when the transformer is unavailable
 * (missing binding locally, quota error 9422, transform outage):
 * an original that ALREADY fits the hero box and the hero byte target
 * needs no optimization to meet the contract, so it is stored as the
 * hero and reused as the thumb. Anything bigger is rejected — an
 * oversized unoptimized file is never silently stored. The caller
 * records `processing` on the media row and surfaces the warning, so
 * the fallback is visible in storage accounting and admin/API output.
 */
export function fallbackProcessedImage(bytes: Uint8Array, cause: ImagePipelineError): ProcessedImage | null {
  const source = probeImage(bytes);
  if (!source) return null;
  const heroPlan = plannedDimensions(source, HERO_SPEC);
  if (heroPlan.resized || bytes.length > HERO_SPEC.softMaxBytes) return null;
  const mime = FORMAT_MIME[source.format];
  const variant = (spec: VariantSpec): ProcessedVariant => ({
    spec,
    bytes,
    contentType: mime as "image/webp",
    width: source.width,
    height: source.height,
    qualityUsed: 0,
    overSoftTarget: false,
    transformCalls: 0,
  });
  return {
    source,
    hero: variant(HERO_SPEC),
    thumb: variant(THUMB_SPEC),
    warnings: [`image transform unavailable (${cause.code}); stored the original because it already fits ${HERO_SPEC.maxWidth}x${HERO_SPEC.maxHeight} and ${HERO_SPEC.softMaxBytes} bytes`],
    transformCalls: 0,
  };
}
