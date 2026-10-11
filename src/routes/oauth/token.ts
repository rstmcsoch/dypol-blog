import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/oauth/token")({
  server: {
    handlers: {
      POST: async ({ request }) => (await import("@/lib/mcp/oauth.server")).token(request),
    },
  },
});
