import { HardDrive } from "lucide-react";
import {
  formatByteSize,
  formatExactBytes,
  formatMeasuredIst,
  formatShare,
  sharePercent,
  type ArticleStorageReading,
} from "@/lib/r2-usage";

/** Same tokens as the other admin desk cards (surface, line, radius, shadow, primary). */
const STORAGE_CSS = `
.adm-storage {
  grid-column: 1 / -1;
  border: 1px solid var(--a-line);
  border-radius: var(--a-radius);
  background: var(--a-surface);
  box-shadow: var(--a-shadow);
  padding: 1rem 1.1rem;
  display: grid;
  gap: 0.55rem;
  min-width: 0;
}
.desk .adm-storage {
  border: 1px solid transparent;
  border-radius: var(--a-radius);
  background: var(--a-surface);
  box-shadow: var(--a-shadow);
  padding: 1rem 1.1rem;
}
.desk[data-cards="border"] .adm-storage {
  border-color: var(--a-line);
  box-shadow: none;
}
.desk[data-theme="dark"] .adm-storage {
  border-color: var(--a-line);
}
.adm-storage__top {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-end;
  flex-wrap: wrap;
}
.adm-storage__value {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 750;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.adm-storage__of {
  color: var(--a-muted);
  font-weight: 600;
  font-size: 0.95rem;
}
.adm-storage__share {
  margin: 0;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--a-primary);
}
.adm-storage__track {
  height: 10px;
  border: 1px solid var(--a-line);
  border-radius: 999px;
  background: color-mix(in srgb, var(--a-muted) 16%, transparent);
  overflow: hidden;
}
.adm-storage__fill {
  height: 100%;
  background: var(--a-primary);
  border-radius: inherit;
}
.adm-storage__meta {
  margin: 0;
  color: var(--a-muted);
  font-size: 0.78rem;
  line-height: 1.45;
}
`;

export function ArticleStorageCard({
  reading,
  error,
}: {
  reading: ArticleStorageReading | null;
  error: string | null;
}) {
  const frame = <style>{STORAGE_CSS}</style>;

  if (error || !reading) {
    return (
      <article className="adm-storage" aria-label="Article storage">
        {frame}
        <p className="adm-stat__kicker">
          <HardDrive size={13} strokeWidth={1.8} aria-hidden /> Article storage
        </p>
        <p className="adm-storage__meta">{error ?? "Storage has not been counted yet."}</p>
      </article>
    );
  }

  const percent = sharePercent(reading.payloadBytes, reading.quotaBytes);
  const width = reading.payloadBytes <= 0 ? 0 : Math.min(100, Math.max(percent, 0.4));
  const check =
    reading.reconciled === "match"
      ? "Cloudflare’s storage metric matches this listing to the byte."
      : reading.reconciled === "lag"
        ? "Cloudflare’s analytics sample still lags this listing, so the listing is what is shown."
        : "Every object in the article bucket was listed. The total is payload bytes, the same figure as Cloudflare R2 storage. Metadata is not included.";

  return (
    <article className="adm-storage" aria-label="Article storage">
      {frame}
      <div className="adm-storage__top">
        <div>
          <p className="adm-stat__kicker">
            <HardDrive size={13} strokeWidth={1.8} aria-hidden /> Article storage
          </p>
          <p className="adm-storage__value">
            {formatByteSize(reading.payloadBytes)}{" "}
            <span className="adm-storage__of">of {formatByteSize(reading.quotaBytes)}</span>
          </p>
        </div>
        <p className="adm-storage__share">{formatShare(reading.payloadBytes, reading.quotaBytes)}</p>
      </div>
      <div
        className="adm-storage__track"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={reading.quotaBytes}
        aria-valuenow={reading.payloadBytes}
        aria-label="Article media used of included Cloudflare R2 storage"
      >
        <div className="adm-storage__fill" style={{ width: `${width}%` }} />
      </div>
      <p className="adm-storage__meta">
        {formatExactBytes(reading.payloadBytes)} across {reading.objectCount.toLocaleString("en-US")}{" "}
        {reading.objectCount === 1 ? "file" : "files"} in {reading.bucket}. {check} Counted{" "}
        {formatMeasuredIst(reading.measuredAt)}, then held for the rest of that IST day.
      </p>
    </article>
  );
}
