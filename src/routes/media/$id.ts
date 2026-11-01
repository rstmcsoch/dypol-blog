import { createFileRoute } from "@tanstack/react-router";

const IMMUTABLE = "public, max-age=31536000, immutable";
// Unversioned URLs (OG/JSON-LD, logo, favicon, admin) may change bytes after a
// backfill, so they revalidate daily via ETag instead of being pinned for a year.
const UNVERSIONED = "public, max-age=86400, stale-while-revalidate=604800";
const MISMATCH = "public, max-age=60";

export const Route = createFileRoute("/media/$id")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { MediaBindingError, serveMedia } = await import("@/content/media-store.server");
        try {
          // /media/<id> serves the hero variant; ?variant=thumb the
          // thumbnail. Legacy media without variants fall back to the
          // original object inside the store. Unknown values = hero.
          // ?v=<token> (t147) marks a content-versioned, immutable URL.
          const url = new URL(request.url);
          const variant = url.searchParams.get("variant") === "thumb" ? "thumb" : "hero";
          const requested = url.searchParams.get("v");
          const file = await serveMedia(params.id, variant, { requestedVersion: requested, ifNoneMatch: request.headers.get("if-none-match") });
          if (!file) return new Response("Not found", { status: 404 });
          const cacheControl = requested ? (requested === file.version ? IMMUTABLE : MISMATCH) : UNVERSIONED;
          const headers: Record<string, string> = {
            "content-type": file.mime,
            "cache-control": cacheControl,
            etag: file.etag,
            "x-content-type-options": "nosniff",
          };
          if (!file.body) return new Response(null, { status: 304, headers });
          if (file.size !== null) headers["content-length"] = String(file.size);
          return new Response(file.body, { headers });
        } catch (error) {
          if (error instanceof MediaBindingError) {
            return new Response(error.message, { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
          }
          throw error;
        }
      },
    },
  },
});
