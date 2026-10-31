import { createFileRoute } from "@tanstack/react-router";

/**
 * Standalone Lens Division page. Full document, intentionally unlisted:
 * no nav, footer, or sitemap entry.
 */
export const Route = createFileRoute("/photolab")({
  server: {
    handlers: {
      GET: async () => {
        const { workerEnv } = await import("@/lib/cf-env.server");
        const env = (await workerEnv()) as {
          MEDIA?: {
            get: (key: string) => Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>;
          };
        };
        const obj = await env.MEDIA?.get("_photolab/page.html");
        if (!obj) return new Response("Not found", { status: 404 });
        return new Response(obj.body, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "public, max-age=300",
          },
        });
      },
    },
  },
});
