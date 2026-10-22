import { getSql, type Sql } from "@/lib/db";
import { classifyAcquisition, classifyUserAgent, cleanCountry, cleanRegion } from "./classify";
import { bucketIndex, scrollFlags } from "./histogram";
import type { ClientFields, EngageBody } from "./payload";
import { kolkataDay } from "./range";
import { STATS_SCHEMA_STATEMENTS } from "./schema";

let schemaReady: Promise<void> | null = null;

export function ensureStatsSchema(sql: Sql): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const statement of STATS_SCHEMA_STATEMENTS) await sql.query(statement);
    })().catch((error: unknown) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

type Ctx = ReturnType<typeof contextOf>;

function contextOf(request: Request, fields: ClientFields, now: Date) {
  const tech = classifyUserAgent(request.headers.get("user-agent") ?? "");
  const cf = (request as Request & { cf?: { country?: string; region?: string } }).cf;
  const country = cleanCountry(request.headers.get("cf-ipcountry") || cf?.country || "XX");
  const acquisition = classifyAcquisition({
    refHost: fields.refHost,
    selfHost: safeHost(request.url),
    utmSource: fields.utmSource,
    utmMedium: fields.utmMedium,
    utmCampaign: fields.utmCampaign,
  });
  return {
    day: kolkataDay(now),
    ...tech,
    country,
    region: cleanRegion(cf?.region ?? null),
    acquisition,
    inboundArticle: fields.inboundArticle,
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

async function touchMeta(sql: Sql, now: Date) {
  await sql.query(
    `insert into stats_meta (key, value) values ('last_event_at', $1)
     on conflict (key) do update set value = excluded.value`,
    [now.toISOString()],
  );
}

async function bumpSite(sql: Sql, day: string, articleViews: number, otherViews: number) {
  await sql.query(
    `insert into site_daily_stats (day, article_views, other_views) values ($1, $2, $3)
     on conflict (day) do update set
       article_views = article_views + excluded.article_views,
       other_views = other_views + excluded.other_views`,
    [day, articleViews, otherViews],
  );
}

async function bumpChannel(sql: Sql, ctx: Ctx, views: number) {
  await sql.query(
    `insert into traffic_daily_stats (day, channel, views, engaged_views, engaged_ms) values ($1, $2, $3, 0, 0)
     on conflict (day, channel) do update set views = views + excluded.views`,
    [ctx.day, ctx.acquisition.channel, views],
  );
  const host = ctx.acquisition.host;
  if (host && (ctx.acquisition.channel === "organic" || ctx.acquisition.channel === "social" || ctx.acquisition.channel === "referral")) {
    await sql.query(
      `insert into referrer_daily_stats (day, host, views) values ($1, $2, $3)
       on conflict (day, host) do update set views = views + excluded.views`,
      [ctx.day, host, views],
    );
  }
  const campaign = ctx.acquisition.campaign;
  if (campaign) {
    await sql.query(
      `insert into campaign_daily_stats (day, source, medium, campaign, views) values ($1, $2, $3, $4, $5)
       on conflict (day, source, medium, campaign) do update set views = views + excluded.views`,
      [ctx.day, campaign.source, campaign.medium, campaign.campaign, views],
    );
  }
}

async function bumpTech(sql: Sql, ctx: Ctx, views: number) {
  await sql.query(
    `insert into device_daily_stats (day, device, views, engaged_views, engaged_ms) values ($1, $2, $3, 0, 0)
     on conflict (day, device) do update set views = views + excluded.views`,
    [ctx.day, ctx.device, views],
  );
  await sql.query(
    `insert into browser_daily_stats (day, browser, views) values ($1, $2, $3)
     on conflict (day, browser) do update set views = views + excluded.views`,
    [ctx.day, ctx.browser, views],
  );
  await sql.query(
    `insert into os_daily_stats (day, os, views) values ($1, $2, $3)
     on conflict (day, os) do update set views = views + excluded.views`,
    [ctx.day, ctx.os, views],
  );
  await sql.query(
    `insert into geo_daily_stats (day, country, views, engaged_views, engaged_ms) values ($1, $2, $3, 0, 0)
     on conflict (day, country) do update set views = views + excluded.views`,
    [ctx.day, ctx.country, views],
  );
  if (ctx.region) {
    await sql.query(
      `insert into region_daily_stats (day, country, region, views) values ($1, $2, $3, $4)
       on conflict (day, country, region) do update set views = views + excluded.views`,
      [ctx.day, ctx.country, ctx.region, views],
    );
  }
}

async function bumpEngagedDims(sql: Sql, ctx: Ctx, engagedMs: number) {
  await sql.query(
    `update traffic_daily_stats set engaged_views = engaged_views + 1, engaged_ms = engaged_ms + $3
     where day = $1 and channel = $2`,
    [ctx.day, ctx.acquisition.channel, engagedMs],
  );
  await sql.query(
    `update device_daily_stats set engaged_views = engaged_views + 1, engaged_ms = engaged_ms + $3
     where day = $1 and device = $2`,
    [ctx.day, ctx.device, engagedMs],
  );
  await sql.query(
    `update geo_daily_stats set engaged_views = engaged_views + 1, engaged_ms = engaged_ms + $3
     where day = $1 and country = $2`,
    [ctx.day, ctx.country, engagedMs],
  );
}

export async function rollupArticleView(sql: Sql, articleId: string, request: Request, fields: ClientFields, now = new Date()): Promise<void> {
  await ensureStatsSchema(sql);
  const ctx = contextOf(request, fields, now);
  const inbound = ctx.inboundArticle ? 1 : 0;
  await sql.query(
    `insert into article_daily_stats (
       article_id, day, views, engaged_views, engaged_ms, scroll_25, scroll_50, scroll_75, scroll_90, scroll_end,
       internal_clicks, recirc_views, inbound_internal, b0, b1, b2, b3, b4, b5, b6
     ) values ($1, $2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, $3, 0, 0, 0, 0, 0, 0, 0)
     on conflict (article_id, day) do update set
       views = views + 1,
       inbound_internal = inbound_internal + excluded.inbound_internal`,
    [articleId, ctx.day, inbound],
  );
  await bumpSite(sql, ctx.day, 1, 0);
  await bumpChannel(sql, ctx, 1);
  await bumpTech(sql, ctx, 1);
  await touchMeta(sql, now);
}

export async function rollupOtherView(sql: Sql, request: Request, fields: ClientFields, now = new Date()): Promise<void> {
  await ensureStatsSchema(sql);
  const ctx = contextOf(request, fields, now);
  await bumpSite(sql, ctx.day, 0, 1);
  await bumpChannel(sql, ctx, 1);
  await bumpTech(sql, ctx, 1);
  await touchMeta(sql, now);
}

export async function rollupEngagement(sql: Sql, articleId: string, request: Request, body: EngageBody, now = new Date()): Promise<void> {
  await ensureStatsSchema(sql);
  const ctx = contextOf(request, body, now);
  const flags = scrollFlags(body.scrollPct);
  const bucket = bucketIndex(body.engagedMs);
  const bumps = [0, 0, 0, 0, 0, 0, 0];
  bumps[bucket] = 1;
  const recirc = body.internalClicks > 0 ? 1 : 0;
  const existing = await sql.query<{ article_id: string }>(
    `select article_id from article_daily_stats where article_id = $1 and day = $2 limit 1`,
    [articleId, ctx.day],
  );
  if (!existing.length) return;
  await sql.query(
    `update article_daily_stats set
       engaged_views = engaged_views + 1,
       engaged_ms = engaged_ms + $3,
       scroll_25 = scroll_25 + $4,
       scroll_50 = scroll_50 + $5,
       scroll_75 = scroll_75 + $6,
       scroll_90 = scroll_90 + $7,
       scroll_end = scroll_end + $8,
       internal_clicks = internal_clicks + $9,
       recirc_views = recirc_views + $10,
       b0 = b0 + $11, b1 = b1 + $12, b2 = b2 + $13, b3 = b3 + $14, b4 = b4 + $15, b5 = b5 + $16, b6 = b6 + $17
     where article_id = $1 and day = $2`,
    [
      articleId,
      ctx.day,
      body.engagedMs,
      flags.s25,
      flags.s50,
      flags.s75,
      flags.s90,
      flags.end,
      body.internalClicks,
      recirc,
      ...bumps,
    ],
  );
  await bumpEngagedDims(sql, ctx, body.engagedMs);
  await touchMeta(sql, now);
}

export async function recordArticleRollup(slug: string, request: Request, fields: ClientFields): Promise<void> {
  const sql = await getSql();
  const rows = await sql<{ id: string }>`select id from articles where slug = ${slug} and status = 'published' limit 1`;
  const id = rows[0]?.id;
  if (!id) return;
  await rollupArticleView(sql, id, request, fields);
}

export async function recordOtherRollup(request: Request, fields: ClientFields): Promise<void> {
  const sql = await getSql();
  await rollupOtherView(sql, request, fields);
}

export async function recordEngagementRollup(slug: string, request: Request, body: EngageBody): Promise<void> {
  const sql = await getSql();
  const rows = await sql<{ id: string }>`select id from articles where slug = ${slug} and status = 'published' limit 1`;
  const id = rows[0]?.id;
  if (!id) return;
  await rollupEngagement(sql, id, request, body);
}
