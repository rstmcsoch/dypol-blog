import { createFileRoute } from "@tanstack/react-router";
import { requireAdmin } from "@/lib/auth/admin.server";

/**
 * Weekly stats digest (last 7 IST days vs the previous 7) as JSON plus a
 * plain-text `summary`. Admin-only; delivery (email etc.) is handled elsewhere.
 * `?format=text` returns just the summary.
 */
export const Route = createFileRoute("/admin/api/stats/digest")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await requireAdmin();
        } catch {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json", "cache-control": "no-store", "x-robots-tag": "noindex" },
          });
        }
        const { analyticsDigest } = await import("@/content/analytics.server");
        const digest = await analyticsDigest();
        const text = new URL(request.url).searchParams.get("format") === "text";
        return new Response(text ? digest.summary : JSON.stringify(digest, null, 2), {
          status: 200,
          headers: {
            "content-type": text ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
            "cache-control": "no-store",
            "x-robots-tag": "noindex",
          },
        });
      },
    },
  },
});
