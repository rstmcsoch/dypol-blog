import { createFileRoute } from "@tanstack/react-router";

/**
 * Token-protected automation tick: `/api/automation/tick`.
 *
 * Cloudflare's Cron Trigger calls the Worker's `scheduled` handler directly, so
 * this endpoint exists for two honest purposes: an external cron/uptime service
 * that cannot use Workers cron, and manual/verification runs from an operator.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` (falls back to `MCP_TOKEN`).
 * With neither secret configured the endpoint answers 503 — it never runs
 * unauthenticated, and it never returns configuration or credentials.
 *
 * Query: `?dry=1` (simulate, write nothing), `?automation=<id>` (only that one),
 * `?force=1` (run it even if it is not due yet — still honours the per-automation
 * lock, retry limit and the publishing policy).
 */
export const Route = createFileRoute("/api/automation/tick")({
  server: {
    handlers: {
      GET: async ({ request }) => (await import("@/lib/automation/tick.server")).handleTick(request),
      POST: async ({ request }) => (await import("@/lib/automation/tick.server")).handleTick(request),
    },
  },
});
