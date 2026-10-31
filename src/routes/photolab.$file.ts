import { createFileRoute } from "@tanstack/react-router";

/**
 * Gallery frames for /photolab. Serves high-resolution camera assets from R2 storage.
 */
export const Route = createFileRoute("/photolab/$file")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { workerEnv } = await import("@/lib/cf-env.server");
        const env = (await workerEnv()) as {
          MEDIA?: {
            get: (key: string) => Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>;
          };
        };
        const file = params.file;
        const obj = await env.MEDIA?.get(`_photolab/${file}`);
        if (!obj) return new Response("Not found", { status: 404 });
        return new Response(obj.body, {
          headers: {
            "content-type": obj.httpMetadata?.contentType || "image/jpeg",
            "cache-control": "public, max-age=86400, immutable",
          },
        });
      },
    },
  },
});
