import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/oauth/token")({
  server: {
    handlers: {
      OPTIONS: async () => (await import("@/lib/mcp/oauth.server")).preflight(),
      POST: async ({ request }) => (await import("@/lib/mcp/oauth.server")).token(request),
    },
  },
});
