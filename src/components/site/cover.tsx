import type { CoverFallback, CoverImage, CoverMotif } from "@/content/types";
import { CoverPlate } from "./cover-plate";
import { mediaUrl } from "@/lib/media-url";

/**
 * Article cover: the stored image when there is one; otherwise the owner's
 * fallback choice: the original geometric "plate", a quiet minimal panel, or
 * nothing at all (returns null so callers can drop the hero).
 */
export function Cover({
  mediaId,
  fallback,
  motif,
  index,
  category,
  title,
  alt,
  image,
  priority = false,
}: {
  mediaId: string | null | undefined;
  fallback: CoverFallback;
  motif: CoverMotif;
  index: string;
  category: string;
  title: string;
  /** Stored descriptive alt for the image; falls back to the article title. */
  alt?: string | null;
  /** t147: version token + real size from the media row. */
  image?: CoverImage | null;
  /** True only for the article hero (likely LCP): load eagerly, high priority. */
  priority?: boolean;
}) {
  if (mediaId)
    return (
      <img
        className="article-cover"
        src={mediaUrl(mediaId, "hero", image?.v)}
        alt={alt?.trim() ? alt : title}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
        width={1200}
        height={675}
      />
    );
  if (fallback === "none") return null;
  if (fallback === "plate") return <CoverPlate motif={motif} index={index} category={category} />;
  return (
    <div className="cover-minimal" aria-hidden="true">
      <span className="cover-minimal__cat">{category}</span>
      <span className="cover-minimal__title">{title}</span>
    </div>
  );
}

export function hasCover(mediaId: string | null | undefined, fallback: CoverFallback): boolean {
  return Boolean(mediaId) || fallback !== "none";
}
