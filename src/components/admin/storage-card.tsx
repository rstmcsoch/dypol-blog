import { HardDrive } from "lucide-react";
import {
  formatByteSize,
  formatExactBytes,
  formatMeasuredIst,
  formatShare,
  sharePercent,
  type ArticleStorageReading,
} from "@/lib/r2-usage";

export function ArticleStorageCard({
  reading,
  error,
}: {
  reading: ArticleStorageReading | null;
  error: string | null;
}) {
  if (error || !reading) {
    return (
      <article className="adm-storage" aria-label="Article storage">
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
