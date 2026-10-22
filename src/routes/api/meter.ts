import { createFileRoute } from "@tanstack/react-router";

/**
 * One non-article page view (home, topics, static pages). The path is checked
 * and then discarded — only a daily total is stored, not the URL.
 * Article pages are counted by /api/views instead.
 */
async function meter(request: Request): Promise<Response> {
  const { shouldMeterPath } = await import("@/lib/stats/classify");
  const { clientAddress, noContent, publicStatGate } = await import("@/lib/stats/http.server");
  const { parseClientFields, readJsonLimited } = await import("@/lib/stats/payload");
  let raw: unknown;
  try {
    raw = await readJsonLimited(request);
  } catch {
    return new Response(null, { status: 400, headers: { "cache-control": "no-store" } });
  }
  const path = raw && typeof raw === "object" && typeof (raw as { path?: unknown }).path === "string" ? (raw as { path: string }).path : "";
  const normalized = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  if (!shouldMeterPath(normalized)) return noContent();
  const blocked = await publicStatGate(request, `meter:${clientAddress(request)}:${normalized}`);
  if (blocked) return blocked;
  try {
    const { recordOtherRollup } = await import("@/lib/stats/ingest.server");
    await recordOtherRollup(request, parseClientFields(raw));
  } catch (error) {
    console.error("[meter] not recorded", error instanceof Error ? error.message : "unknown");
  }
  return noContent();
}

export const Route = createFileRoute("/api/meter")({
  server: {
    handlers: {
      POST: async ({ request }) => meter(request),
    },
  },
});
