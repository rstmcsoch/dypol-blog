import { createFileRoute } from "@tanstack/react-router";

/** t173: chart SVG of a published special article, rendered from its stored data. Static, script-free. */
export const Route = createFileRoute("/special-charts/$slug/$chartId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const chartId = String(params.chartId).replace(/\.svg$/, "");
        if (!/^[A-Za-z0-9_-]{1,60}$/.test(chartId) || !/^[a-z0-9-]{1,120}$/.test(params.slug)) return new Response("Not found", { status: 404 });
        const { readSpecialChart } = await import("@/content/special.server");
        const svg = await readSpecialChart(params.slug, chartId).catch(() => null);
        if (!svg) return new Response("Not found", { status: 404 });
        return new Response(svg, {
          headers: {
            "content-type": "image/svg+xml; charset=utf-8",
            "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
            "x-content-type-options": "nosniff",
            "cache-control": "public, max-age=300",
          },
        });
      },
    },
  },
});
