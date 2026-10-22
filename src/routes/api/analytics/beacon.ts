import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { kolkataDate } from "@/lib/analytics-dates";
import { getSql } from "@/lib/db";

type Limiter = { limit(input: { key: string }): Promise<{ success: boolean }> };

const BeaconPayload = z.object({
  sessionId: z.string().min(8).max(64),
  articleId: z.string().nullable().optional(),
  path: z.string().max(200),
  referrer: z.string().max(500).nullable().optional(),
  source: z.enum(["direct", "internal", "referral", "social", "organic", "campaign"]).optional(),
  deviceCategory: z.enum(["desktop", "mobile", "tablet"]),
  pageViews: z.number().int().min(0).max(100).default(0),
  engagedSeconds: z.number().min(0).max(3600).default(0),
  engagedSession: z.boolean().default(false),
  maxScroll: z.number().int().min(0).max(100).default(0),
  completed: z.boolean().default(false),
  linkClicks: z.array(z.object({ to: z.string().max(200) })).max(50).default([]),
  milestones: z.array(z.number().int().min(0).max(100)).max(4).default([]),
  final: z.boolean().default(false),
});

type BeaconInput = z.infer<typeof BeaconPayload>;

const none = () => new Response(null, { status: 204, headers: { "cache-control": "no-store" } });

async function count(request: Request): Promise<Response> {
  // Same-origin only.
  const origin = request.headers.get("origin");
  const requestUrl = new URL(request.url);
  if (origin && origin !== requestUrl.origin) return new Response(null, { status: 403 });
  // Browsers sending a navigation fetch always identify themselves.
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!origin && fetchSite !== "same-origin" && fetchSite !== "none") return none();

  // Never count bots/crawlers/preview fetchers in reader analytics.
  const ua = (request.headers.get("user-agent") ?? "").toLowerCase();
  if (/bot|crawl|spider|slurp|facebookexternalhit|preview|headless|lighthouse/i.test(ua)) return none();

  const env = (await import("@/lib/cf-env.server").then((m) => m.workerEnv())) as { MCP_LIMITER?: Limiter };
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  if (env.MCP_LIMITER) {
    const { success } = await env.MCP_LIMITER.limit({ key: `beacon:${ip}` });
    if (!success) return none();
  }

  let input: BeaconInput;
  try {
    input = BeaconPayload.parse(await request.json());
  } catch {
    return new Response(null, { status: 400 });
  }

  const date = kolkataDate(new Date().toISOString());
  const now = new Date().toISOString();
  const sql = await getSql();

  try {
    // Session registry: one row per reader session, aggregates only.
    await sql`
      insert into analytics_sessions (session_id, started_at, last_seen, source, medium, referrer_domain, device_category, page_views, engaged_seconds, bounced)
      values (${input.sessionId}, ${now}, ${now}, ${input.source ?? "direct"}, ${input.source === "campaign" ? "cpc" : input.source ?? "direct"}, ${input.referrer ?? ""}, ${input.deviceCategory}, ${input.pageViews}, ${input.engagedSeconds}, ${input.pageViews <= 1 ? 1 : 0})
      on conflict (session_id) do update set
        last_seen = excluded.last_seen,
        page_views = page_views + excluded.page_views,
        engaged_seconds = engaged_seconds + excluded.engaged_seconds,
        bounced = case when (page_views + excluded.page_views) <= 1 then 1 else 0 end
    `;

    if (input.articleId) {
      await sql`
        insert into analytics_article_session (article_id, date, session_id, page_views, engaged_seconds, engaged_sessions, max_scroll, completed)
        values (${input.articleId}, ${date}, ${input.sessionId}, ${input.pageViews}, ${input.engagedSeconds}, ${input.engagedSession ? 1 : 0}, ${input.maxScroll}, ${input.completed ? 1 : 0})
        on conflict (article_id, date, session_id) do update set
          page_views = page_views + excluded.page_views,
          engaged_seconds = engaged_seconds + excluded.engaged_seconds,
          engaged_sessions = engaged_sessions + excluded.engaged_sessions,
          max_scroll = max(max_scroll, excluded.max_scroll),
          completed = max(completed, excluded.completed)
      `;
    }

    if (input.articleId && input.linkClicks.length > 0) {
      for (const click of input.linkClicks) {
        let toArticleId: string | null = null;
        const slug = click.to.startsWith("/articles/") ? click.to.slice("/articles/".length) : null;
        if (slug) {
          const rows = await sql<{ id: string }>`select id from articles where slug = ${slug} limit 1`;
          toArticleId = rows[0]?.id ?? null;
        }
        if (toArticleId) {
          await sql`
            insert into analytics_link_clicks (from_article_id, to_article_id, date, clicks)
            values (${input.articleId}, ${toArticleId}, ${date}, 1)
            on conflict (from_article_id, to_article_id, date) do update set clicks = clicks + 1
          `;
        }
      }
    }
  } catch (error) {
    console.error("[analytics/beacon] not recorded", error instanceof Error ? error.message : "unknown");
  }

  return none();
}

export const Route = createFileRoute("/api/analytics/beacon")({
  server: {
    handlers: {
      POST: async ({ request }) => count(request),
    },
  },
});
