import { createFileRoute } from "@tanstack/react-router";

/**
 * t69 404 log beacon: the public NotFound page POSTs the missed path here
 * (real readers only — bots without JS never appear, by design). Aggregated
 * per path in D1 (path, referrer, hits, last seen), capped at 5,000 paths.
 * Same-origin only; always 204 so it can never break the 404 page.
 */
async function log(request: Request): Promise<Response> {
  const none = new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
  const ua = request.headers.get("user-agent") ?? "";
  if (/bot|crawl|spider|slurp|facebookexternalhit|preview/i.test(ua)) return none;
  try {
    const body = (await request.json().catch(() => null)) as { path?: unknown; referrer?: unknown } | null;
    if (!body || typeof body.path !== "string") return none;
    const { writesAllowed } = await import("@/lib/write-guard.server");
    if (!(await writesAllowed())) return none;
    const { recordNotFound } = await import("@/content/repository.server");
    await recordNotFound(body.path, typeof body.referrer === "string" ? body.referrer : "");
  } catch { /* best-effort */ }
  return none;
}

export const Route = createFileRoute("/api/not-found")({
  server: { handlers: { POST: async ({ request }) => log(request) } },
});
