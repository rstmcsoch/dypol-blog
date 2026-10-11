import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/mcp")({
  server: {
    handlers: {
      POST: async ({ request }) => (await import("@/lib/mcp/http.server")).handleMcp(request),
      GET: async ({ request }) => (await import("@/lib/mcp/http.server")).handleMcp(request),
      DELETE: async ({ request }) => (await import("@/lib/mcp/http.server")).handleMcp(request),
    },
  },
});
