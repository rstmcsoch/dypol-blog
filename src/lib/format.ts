const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

export function padIndex(n: number): string {
  return String(n).padStart(2, "0");
}

/** True when an article was genuinely edited after publication (t91; t115:
 * more than an hour later, so publish-time touch-ups never show as an update). */
export function isMeaningfullyUpdated(publishedAt: string | null, updatedAt: string): boolean {
  if (!publishedAt) return false;
  const published = Date.parse(publishedAt);
  const updated = Date.parse(updatedAt);
  if (Number.isNaN(published) || Number.isNaN(updated)) return false;
  return updated - published > 3_600_000;
}
