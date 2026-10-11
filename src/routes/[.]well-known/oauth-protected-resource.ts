import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/.well-known/oauth-protected-resource")({
  server: {
    handlers: {
      OPTIONS: async () => (await import("@/lib/mcp/oauth.server")).preflight(),
      GET: async ({ request }) => (await import("@/lib/mcp/oauth.server")).protectedResourceMetadata(request),
    },
  },
});
