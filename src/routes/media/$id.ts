import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/media/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { readMediaFile } = await import("@/content/repository.server");
        const { MediaBindingError } = await import("@/content/media-store.server");
        try {
          const file = await readMediaFile(params.id);
          if (!file) return new Response("Not found", { status: 404 });
          const body = new Uint8Array(file.bytes.byteLength);
          body.set(file.bytes);
          return new Response(body, {
            headers: {
              "content-type": file.mime,
              "cache-control": "public, max-age=3600",
              "x-content-type-options": "nosniff",
            },
          });
        } catch (error) {
          if (error instanceof MediaBindingError) {
            return new Response(error.message, { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
          }
          throw error;
        }
      },
    },
  },
});
