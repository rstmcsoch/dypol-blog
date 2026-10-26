/**
 * Article-media storage math. Cloudflare R2 bills storage in decimal
 * gigabytes (1 GB = 1e9 bytes). The included allowance on every R2 plan
 * is a fixed 10 GB-month.
 */
export const R2_INCLUDED_STORAGE_BYTES = 10_000_000_000;

export const ARTICLE_MEDIA_BUCKET = "dypol-blog-media";

const IST = "Asia/Kolkata";

export type ListedObject = { size: number };

export type ListableBucket = {
  list(options?: { cursor?: string; limit?: number }): Promise<{
    objects: ListedObject[];
    truncated?: boolean;
    cursor?: string;
  }>;
};

const MAX_LIST_PAGES = 200;

/**
 * Every object in the bucket, paginated. A truncated listing throws:
 * a partial sum must never be shown as the total.
 */
export async function listEntireBucket(bucket: ListableBucket): Promise<{ bytes: number; count: number }> {
  const objects: ListedObject[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const listed = await bucket.list({ cursor, limit: 1000 });
    if (!listed || !Array.isArray(listed.objects)) {
      throw new Error("R2 listing returned no object list. No storage total was saved.");
    }
    objects.push(...listed.objects);
    if (!listed.truncated) return sumObjectSizes(objects);
    if (!listed.cursor || listed.cursor === cursor) {
      throw new Error("R2 listing stopped early. No storage total was saved.");
    }
    cursor = listed.cursor;
  }
  throw new Error("R2 listing exceeded the page cap. No storage total was saved.");
}

export function sumObjectSizes(objects: readonly ListedObject[]): { bytes: number; count: number } {
  let bytes = 0;
  for (const object of objects) {
    if (!Number.isSafeInteger(object.size) || object.size < 0) {
      throw new Error("Refusing a storage total: an object size is not a whole byte count.");
    }
    bytes += object.size;
  }
  if (!Number.isSafeInteger(bytes)) {
    throw new Error("Refusing a storage total: the byte sum is not a safe integer.");
  }
  return { bytes, count: objects.length };
}

/** Decimal units, matching the Cloudflare R2 dashboard and invoice. */
export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  const units = [
    { limit: 1_000_000, div: 1000, suffix: "KB" },
    { limit: 1_000_000_000, div: 1_000_000, suffix: "MB" },
    { limit: 1_000_000_000_000, div: 1_000_000_000, suffix: "GB" },
  ];
  for (const unit of units) {
    if (bytes < unit.limit) return `${trim(bytes / unit.div)} ${unit.suffix}`;
  }
  return `${trim(bytes / 1_000_000_000_000)} TB`;
}

function trim(value: number): string {
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return value.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

export function formatExactBytes(bytes: number): string {
  return `${Math.max(0, Math.round(bytes)).toLocaleString("en-US")} bytes`;
}

/** Share of the fixed quota. Tiny non-zero usage never renders as 0%. */
export function formatShare(usedBytes: number, quotaBytes: number): string {
  if (!Number.isFinite(quotaBytes) || quotaBytes <= 0 || !Number.isFinite(usedBytes) || usedBytes < 0) return "—";
  const percent = (usedBytes / quotaBytes) * 100;
  if (percent > 0 && percent < 0.01) return "<0.01%";
  if (percent < 10) return `${percent.toFixed(2)}%`;
  if (percent < 100) return `${percent.toFixed(1)}%`;
  return `${Math.round(percent)}%`;
}

/** 0–100, unclamped so a bucket over the allowance still reads as over. */
export function sharePercent(usedBytes: number, quotaBytes: number): number {
  if (!Number.isFinite(quotaBytes) || quotaBytes <= 0 || !Number.isFinite(usedBytes) || usedBytes <= 0) return 0;
  return (usedBytes / quotaBytes) * 100;
}

export function parseQuotaBytes(raw: string | undefined): number {
  if (!raw?.trim()) return R2_INCLUDED_STORAGE_BYTES;
  if (!/^\d+$/.test(raw.trim())) return R2_INCLUDED_STORAGE_BYTES;
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value <= 0) return R2_INCLUDED_STORAGE_BYTES;
  return value;
}

/** IST calendar day, `YYYY-MM-DD`. The daily snapshot key. */
export function istCalendarDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function formatMeasuredIst(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown time";
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${formatted} IST`;
}

export type ReconcileState = "match" | "lag" | "unchecked";

export type ArticleStorageReading = {
  bucket: string;
  payloadBytes: number;
  objectCount: number;
  quotaBytes: number;
  measuredAt: string;
  day: string;
  reconciled: ReconcileState;
  analyticsBytes: number | null;
  analyticsSampledAt: string | null;
};

/**
 * Cloudflare's storage analytics (`payloadSize`) is the dashboard figure.
 * It lags the object listing by minutes. Equal means both sources agree.
 */
export function reconcileListing(listedBytes: number, analyticsPayloadBytes: number | null): ReconcileState {
  if (analyticsPayloadBytes == null) return "unchecked";
  return listedBytes === analyticsPayloadBytes ? "match" : "lag";
}
