import { createFileRoute } from "@tanstack/react-router";

/**
 * One reading beacon per counted article view, sent when the page is hidden.
 * Stores only coarse daily totals (time bucket, scroll milestones, internal
 * clicks). A beacon with no matching view row for today is ignored.
 */
async function engage(request: Request): Promise<Response> {
  const { clientAddress, noContent, publicStatGate } = await import("@/lib/stats/http.server");
  const { parseEngageBody, readJsonLimited } = await import("@/lib/stats/payload");
  let body: unknown;
  try {
    body = await readJsonLimited(request);
  } catch {
    return new Response(null, { status: 400, headers: { "cache-control": "no-store" } });
  }
  const parsed = parseEngageBody(body);
  const slug = body && typeof body === "object" && typeof (body as { slug?: unknown }).slug === "string" ? (body as { slug: string }).slug : "";
  if (!parsed || !/^[a-z0-9-]{1,80}$/.test(slug)) {
    return new Response(null, { status: 400, headers: { "cache-control": "no-store" } });
  }
  const blocked = await publicStatGate(request, `engage:${clientAddress(request)}:${slug}`);
  if (blocked) return blocked;
  try {
    const { recordEngagementRollup } = await import("@/lib/stats/ingest.server");
    await recordEngagementRollup(slug, request, parsed);
  } catch (error) {
    console.error("[engage] not recorded", error instanceof Error ? error.message : "unknown");
  }
  return noContent();
}

export const Route = createFileRoute("/api/engage")({
  server: {
    handlers: {
      POST: async ({ request }) => engage(request),
    },
  },
});
