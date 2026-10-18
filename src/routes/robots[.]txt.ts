import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const origin = new URL(request.url).origin;
        const body = `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /login\nDisallow: /preview\nDisallow: /mcp\nDisallow: /api/\nDisallow: /oauth/\n\nSitemap: ${origin}/sitemap.xml\nSitemap: ${origin}/news-sitemap.xml\n`;
        return new Response(body, {
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      },
    },
  },
});
