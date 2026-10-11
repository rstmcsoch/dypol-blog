import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/.well-known/oauth-protected-resource/mcp")({
  server: {
    handlers: {
      GET: async ({ request }) => (await import("@/lib/mcp/oauth.server")).protectedResourceMetadata(request),
    },
  },
});
