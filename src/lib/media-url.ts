/**
 * Public media URLs (t88, PageSpeed image-delivery).
 *
 * `/media/<id>` serves the hero variant (1280x720 WebP, see
 * IMAGE-PIPELINE.md); `/media/<id>?variant=thumb` serves the 480px
 * thumbnail (<=60 KB target). Cards, list rows and sidebar thumbs are
 * displayed at a few hundred CSS pixels at most, so they must never
 * pull the hero — let alone a legacy original, which the server falls
 * back to when a row has no variants yet (run Admin -> Media backfill
 * for those). Only true heroes (homepage lead, article cover) use hero.
 */
export function mediaUrl(id: string, variant: "hero" | "thumb" = "hero"): string {
  return variant === "thumb" ? `/media/${id}?variant=thumb` : `/media/${id}`;
}

export function thumbUrl(id: string): string {
  return mediaUrl(id, "thumb");
}
