import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/oauth/authorize")({
  server: {
    handlers: {
      GET: async ({ request }) => (await import("@/lib/mcp/oauth.server")).authorize(request),
      POST: async ({ request }) => (await import("@/lib/mcp/oauth.server")).authorize(request),
    },
  },
});
