import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { canonicalOriginFrom } = await import("@/lib/seo");
        const origin = canonicalOriginFrom(request.url);
        // The admin entry is /admin (single-entry design): it is disallowed
        // here AND carries a noindex meta. /login only 308-redirects to
        // /admin, so it needs no rule of its own. AI *search* crawlers
        // are expressly allowed on the same terms; training-bot policy is
        // the owner's separate decision and stays under the wildcard rule.
        const privatePaths = ["Disallow: /admin", "Disallow: /preview", "Disallow: /mcp", "Disallow: /api/", "Disallow: /oauth/"].join("\n");
        const body = [
          `User-agent: *\nAllow: /\n${privatePaths}`,
          `User-agent: OAI-SearchBot\nAllow: /\n${privatePaths}`,
          `User-agent: Claude-SearchBot\nAllow: /\n${privatePaths}`,
          `User-agent: Claude-User\nAllow: /\n${privatePaths}`,
          `Sitemap: ${origin}/sitemap.xml\nSitemap: ${origin}/news-sitemap.xml\n`,
        ].join("\n\n");
        return new Response(body, {
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      },
    },
  },
});
