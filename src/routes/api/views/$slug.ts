import { createFileRoute } from "@tanstack/react-router";

/**
 * Privacy-friendly view counter: POST /api/views/<slug> adds 1 to that article.
 * The lifetime integer (article_views) stays one number per article. The same
 * request also adds a daily aggregate used by the admin Stats tab: no IP,
 * cookie, user agent or per-visit row is stored.
 * Same-origin only; bots and signed-in admin browsers are not counted.
 */
async function count(request: Request, slug: string): Promise<Response> {
  const { clientAddress, noContent, publicStatGate } = await import("@/lib/stats/http.server");
  const { parseClientFields, readJsonLimited } = await import("@/lib/stats/payload");
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return noContent();
  const blocked = await publicStatGate(request, `view:${clientAddress(request)}:${slug}`);
  if (blocked) return blocked;
  let fields = parseClientFields({});
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    try {
      fields = parseClientFields(await readJsonLimited(request));
    } catch {
      fields = parseClientFields({});
    }
  }
  try {
    const { recordView } = await import("@/content/repository.server");
    const counted = await recordView(slug);
    if (counted) {
      const { recordArticleRollup } = await import("@/lib/stats/ingest.server");
      await recordArticleRollup(slug, request, fields);
    }
  } catch (error) {
    console.error("[views] not counted", error instanceof Error ? error.message : "unknown");
  }
  return noContent();
}

export const Route = createFileRoute("/api/views/$slug")({
  server: {
    handlers: {
      POST: async ({ request, params }) => count(request, params.slug),
    },
  },
});
