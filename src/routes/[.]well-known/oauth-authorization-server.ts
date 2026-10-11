import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/.well-known/oauth-authorization-server")({
  server: {
    handlers: {
      OPTIONS: async () => (await import("@/lib/mcp/oauth.server")).preflight(),
      GET: async ({ request }) => (await import("@/lib/mcp/oauth.server")).authorizationServerMetadata(request),
    },
  },
});
