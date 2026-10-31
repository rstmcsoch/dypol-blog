import { createFileRoute } from "@tanstack/react-router";
import { workerEnv } from "@/lib/cf-env.server";

const FRAMES = new Set(["01.jpg", "02.jpg", "03.jpg", "04.jpg"]);

/** Gallery frames for /photolab. Not linked from the rest of the site. */
export const Route = createFileRoute("/photolab/$file")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!FRAMES.has(params.file)) return new Response("Not found", { status: 404 });
        const env = await workerEnv();
        const media = env.MEDIA as { get?: (key: string) => Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null> } | undefined;
        const obj = media?.get ? await media.get(`_photolab/${params.file}`) : null;
        if (!obj) return new Response("Not found", { status: 404 });
        return new Response(obj.body, {
          headers: {
            "content-type": obj.httpMetadata?.contentType || "image/jpeg",
            "cache-control": "public, max-age=86400",
          },
        });
      },
    },
  },
});
