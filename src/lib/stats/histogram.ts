/**
 * Coarse engaged-time histogram. One beacon contributes to exactly one bucket.
 * Medians are interpolated inside the bucket that contains the percentile.
 * They are approximate and are never computed by averaging averages.
 *
 * The open-ended last bucket is capped at 20 minutes, which is also the
 * maximum engaged time a beacon is allowed to report.
 */
export const READ_BUCKETS = [
  { id: "lt10", label: "Under 10 seconds", min: 0, max: 10_000 },
  { id: "10_30", label: "10–30 seconds", min: 10_000, max: 30_000 },
  { id: "30_60", label: "30–60 seconds", min: 30_000, max: 60_000 },
  { id: "1_3m", label: "1–3 minutes", min: 60_000, max: 180_000 },
  { id: "3_5m", label: "3–5 minutes", min: 180_000, max: 300_000 },
  { id: "5_10m", label: "5–10 minutes", min: 300_000, max: 600_000 },
  { id: "gt10m", label: "More than 10 minutes", min: 600_000, max: 1_200_000 },
] as const;

export const MAX_ENGAGED_MS = 1_200_000;
export const BUCKET_COUNT = READ_BUCKETS.length;

export function bucketIndex(ms: number): number {
  const t = Math.max(0, Math.min(Math.round(ms), MAX_ENGAGED_MS));
  if (t < 10_000) return 0;
  if (t < 30_000) return 1;
  if (t < 60_000) return 2;
  if (t < 180_000) return 3;
  if (t < 300_000) return 4;
  if (t < 600_000) return 5;
  return 6;
}

export function emptyBuckets(): number[] {
  return [0, 0, 0, 0, 0, 0, 0];
}

/** Linear interpolation within the histogram bucket. Null when there are no samples. */
export function histogramPercentile(counts: readonly number[], percentile: number): number | null {
  if (counts.length !== BUCKET_COUNT) return null;
  const total = counts.reduce((sum, n) => sum + (n > 0 ? n : 0), 0);
  if (total <= 0) return null;
  const p = Math.min(100, Math.max(0, percentile));
  const target = (p / 100) * total;
  let seen = 0;
  for (let i = 0; i < BUCKET_COUNT; i += 1) {
    const count = counts[i] > 0 ? counts[i] : 0;
    if (count === 0) continue;
    if (seen + count >= target || i === BUCKET_COUNT - 1) {
      const bucket = READ_BUCKETS[i];
      const frac = Math.min(1, Math.max(0, (target - seen) / count));
      return bucket.min + frac * (bucket.max - bucket.min);
    }
    seen += count;
  }
  return null;
}

/** Approximate mean using bucket midpoints. Not a substitute for the median. */
export function histogramMean(counts: readonly number[]): number | null {
  if (counts.length !== BUCKET_COUNT) return null;
  const total = counts.reduce((sum, n) => sum + (n > 0 ? n : 0), 0);
  if (total <= 0) return null;
  let weighted = 0;
  for (let i = 0; i < BUCKET_COUNT; i += 1) {
    const count = counts[i] > 0 ? counts[i] : 0;
    const bucket = READ_BUCKETS[i];
    weighted += count * ((bucket.min + bucket.max) / 2);
  }
  return weighted / total;
}

export function addBuckets(into: number[], extra: readonly number[]): void {
  for (let i = 0; i < BUCKET_COUNT; i += 1) into[i] += extra[i] ?? 0;
}

export function scrollFlags(pct: number): { s25: number; s50: number; s75: number; s90: number; end: number } {
  const p = Math.max(0, Math.min(100, pct));
  return {
    s25: p >= 25 ? 1 : 0,
    s50: p >= 50 ? 1 : 0,
    s75: p >= 75 ? 1 : 0,
    s90: p >= 90 ? 1 : 0,
    end: p >= 90 ? 1 : 0,
  };
}
