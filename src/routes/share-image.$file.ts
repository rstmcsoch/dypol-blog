import { createFileRoute } from "@tanstack/react-router";

/**
 * t195: branded share image (Settings → Sharing → Preview image → "Image with logo").
 * /share-image/<baseMediaId>.jpg?v=<version> = the article cover (or default social
 * image) at 1200×630 with the logo drawn on, placed per the settings. Rendered once
 * with the IMAGES binding and stored in R2 (_share/…), so crawlers re-fetching the
 * image never spend another transformation. Any problem (no logo, quota, unknown
 * format) falls back to the plain image, so a link card always has a picture.
 */
type Img = {
  transform(o: Record<string, unknown>): Img;
  draw(img: Img, o: Record<string, unknown>): Img;
  output(o: Record<string, unknown>): Promise<{ response(): Response }>;
};
type Images = { input(s: ReadableStream): Img; info(s: ReadableStream): Promise<{ width?: number; height?: number }> };
type Bucket = {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(key: string, value: ArrayBuffer, o?: Record<string, unknown>): Promise<unknown>;
};

const HEADERS = { "content-type": "image/jpeg", "cache-control": "public, max-age=86400, stale-while-revalidate=604800", "x-content-type-options": "nosniff" };

export const Route = createFileRoute("/share-image/$file")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const match = /^([A-Za-z0-9_-]{1,80})\.jpg$/.exec(params.file);
        if (!match) return new Response("Not found", { status: 404 });
        const base = match[1]!;
        const plain = () => Response.redirect(new URL(`/media/${base}`, request.url).toString(), 302);
        try {
          const [{ readSettings }, { serveMedia }, { normalizeShareConfig, brandLogoId, hash32, logoPlacement }, { workerEnv }] = await Promise.all([
            import("@/content/repository.server"),
            import("@/content/media-store.server"),
            import("@/lib/share-config"),
            import("@/lib/cf-env.server"),
          ]);
          const { site } = await readSettings();
          const cfg = normalizeShareConfig(site.share);
          const logo = brandLogoId(cfg, site.logoMediaId);
          const baseFile = await serveMedia(base, "hero");
          if (!baseFile) return new Response("Not found", { status: 404 });
          if (cfg.image.source !== "branded" || !logo || logo === base) return plain();
          const logoFile = await serveMedia(logo, "hero");
          if (!logoFile?.body || !baseFile.body) return plain();
          const env = (await workerEnv()) as unknown as { IMAGES?: Images; MEDIA?: Bucket };
          if (!env.IMAGES || !env.MEDIA) return plain();
          const { position, size, margin, opacity } = cfg.image;
          const key = `_share/${base}-${hash32([baseFile.version, logo, logoFile.version, position, size, margin, opacity, "v1"].join("|"))}.jpg`;
          const stored = await env.MEDIA.get(key);
          if (stored) return new Response(await stored.arrayBuffer(), { headers: HEADERS });
          const logoBytes = await new Response(logoFile.body).arrayBuffer();
          const info = await env.IMAGES.info(new Blob([logoBytes]).stream());
          const place = logoPlacement(cfg.image, { width: info.width ?? 1, height: info.height ?? 1 });
          const result = await env.IMAGES.input(baseFile.body)
            .transform({ width: 1200, height: 630, fit: "cover" })
            .draw(env.IMAGES.input(new Blob([logoBytes]).stream()).transform({ width: place.width, height: place.height, fit: "contain" }), {
              left: place.left,
              top: place.top,
              opacity: place.opacity,
            })
            .output({ format: "image/jpeg", quality: 85 });
          const response = result.response();
          if (!response.ok) return plain();
          const bytes = await response.arrayBuffer();
          await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: "image/jpeg" } });
          return new Response(bytes, { headers: HEADERS });
        } catch {
          return plain();
        }
      },
    },
  },
});
