import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/oauth/register")({
  server: {
    handlers: {
      POST: async ({ request }) => (await import("@/lib/mcp/oauth.server")).register(request),
    },
  },
});
