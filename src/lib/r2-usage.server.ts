import { workerEnv } from "./cf-env.server";
import { getSql } from "./db";
import {
  ARTICLE_MEDIA_BUCKET,
  listEntireBucket,
  parseQuotaBytes,
  reconcileListing,
  istCalendarDay,
  type ArticleStorageReading,
  type ListableBucket,
  type ReconcileState,
} from "./r2-usage";

const ENSURE_TABLE = `create table if not exists r2_usage_daily (
  day text primary key,
  bucket text not null,
  payload_bytes integer not null,
  object_count integer not null,
  quota_bytes integer not null,
  measured_at text not null,
  analytics_bytes integer,
  analytics_sampled_at text,
  reconciled text not null
)`;

type AnalyticsSample = { payloadBytes: number; objectCount: number; sampledAt: string };

async function cloudflarePayload(accountId: string, token: string, bucket: string): Promise<AnalyticsSample | null> {
  const end = new Date();
  const start = new Date(end.getTime() - 36 * 60 * 60 * 1000);
  const query = `query ($accountTag: String!, $start: Time!, $end: Time!, $bucketName: String!) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        r2StorageAdaptiveGroups(
          limit: 1
          filter: { datetime_geq: $start, datetime_leq: $end, bucketName: $bucketName }
          orderBy: [datetime_DESC]
        ) {
          max { objectCount payloadSize }
          dimensions { datetime }
        }
      }
    }
  }`;
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: {
        accountTag: accountId,
        start: start.toISOString(),
        end: end.toISOString(),
        bucketName: bucket,
      },
    }),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as {
    errors?: unknown[];
    data?: {
      viewer?: {
        accounts?: Array<{
          r2StorageAdaptiveGroups?: Array<{
            max?: { objectCount?: number; payloadSize?: number };
            dimensions?: { datetime?: string };
          }>;
        }>;
      };
    };
  };
  if (body.errors && body.errors.length > 0) return null;
  const row = body.data?.viewer?.accounts?.[0]?.r2StorageAdaptiveGroups?.[0];
  const payload = row?.max?.payloadSize;
  const count = row?.max?.objectCount;
  const sampledAt = row?.dimensions?.datetime;
  if (typeof payload !== "number" || typeof count !== "number" || !sampledAt) return null;
  return { payloadBytes: payload, objectCount: count, sampledAt };
}

function isListable(value: unknown): value is ListableBucket {
  return Boolean(value && typeof value === "object" && typeof (value as ListableBucket).list === "function");
}

function rowToReading(row: {
  bucket: string;
  payload_bytes: number;
  object_count: number;
  quota_bytes: number;
  measured_at: string;
  day: string;
  analytics_bytes: number | null;
  analytics_sampled_at: string | null;
  reconciled: string;
}): ArticleStorageReading {
  const reconciled: ReconcileState =
    row.reconciled === "match" || row.reconciled === "lag" || row.reconciled === "unchecked" ? row.reconciled : "unchecked";
  return {
    bucket: row.bucket,
    payloadBytes: Number(row.payload_bytes),
    objectCount: Number(row.object_count),
    quotaBytes: Number(row.quota_bytes),
    measuredAt: row.measured_at,
    day: row.day,
    reconciled,
    analyticsBytes: row.analytics_bytes == null ? null : Number(row.analytics_bytes),
    analyticsSampledAt: row.analytics_sampled_at,
  };
}

async function measure(env: Awaited<ReturnType<typeof workerEnv>>): Promise<ArticleStorageReading> {
  if (!isListable(env.MEDIA)) {
    throw new Error("The article media bucket is not bound on this deployment.");
  }
  const bucketName = env.MEDIA_BUCKET_NAME?.trim() || ARTICLE_MEDIA_BUCKET;
  const quotaBytes = parseQuotaBytes(env.R2_STORAGE_QUOTA_BYTES);
  const listed = await listEntireBucket(env.MEDIA);
  const token = env.CLOUDFLARE_API_TOKEN?.trim();
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const analytics = token && accountId ? await cloudflarePayload(accountId, token, bucketName).catch(() => null) : null;
  const now = new Date();
  return {
    bucket: bucketName,
    payloadBytes: listed.bytes,
    objectCount: listed.count,
    quotaBytes,
    measuredAt: now.toISOString(),
    day: istCalendarDay(now),
    reconciled: reconcileListing(listed.bytes, analytics?.payloadBytes ?? null),
    analyticsBytes: analytics?.payloadBytes ?? null,
    analyticsSampledAt: analytics?.sampledAt ?? null,
  };
}

function toSqlite(text: string): string {
  return text.replace(/\$(\d+)/g, "?$1");
}

/** Writes go through D1 `run()`. `all()` is only for rows. */
async function d1run(text: string, params: unknown[] = []): Promise<void> {
  const env = await workerEnv();
  const db = env.DB;
  if (!db || typeof db.prepare !== "function") {
    throw new Error("The D1 binding DB is not available in this runtime.");
  }
  const statement = db.prepare(toSqlite(text));
  const bound = params.length ? statement.bind(...params.map((value) => (value === undefined ? null : value))) : statement;
  await bound.run();
}

async function saveReading(reading: ArticleStorageReading): Promise<void> {
  await d1run(ENSURE_TABLE);
  await d1run(
    `insert into r2_usage_daily (
       day, bucket, payload_bytes, object_count, quota_bytes, measured_at,
       analytics_bytes, analytics_sampled_at, reconciled
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict(day) do update set
       bucket = excluded.bucket,
       payload_bytes = excluded.payload_bytes,
       object_count = excluded.object_count,
       quota_bytes = excluded.quota_bytes,
       measured_at = excluded.measured_at,
       analytics_bytes = excluded.analytics_bytes,
       analytics_sampled_at = excluded.analytics_sampled_at,
       reconciled = excluded.reconciled`,
    [
      reading.day,
      reading.bucket,
      reading.payloadBytes,
      reading.objectCount,
      reading.quotaBytes,
      reading.measuredAt,
      reading.analyticsBytes,
      reading.analyticsSampledAt,
      reading.reconciled,
    ],
  );
}

/**
 * One exact listing per IST day. Later views that day read the stored
 * total, so filtering stats does not re-list the bucket.
 */
export async function readDailyArticleStorage(): Promise<ArticleStorageReading> {
  const env = await workerEnv();
  const bucketName = env.MEDIA_BUCKET_NAME?.trim() || ARTICLE_MEDIA_BUCKET;
  const day = istCalendarDay(new Date());
  await d1run(ENSURE_TABLE);
  const sql = await getSql();
  const rows = await sql.query<{
    bucket: string;
    payload_bytes: number;
    object_count: number;
    quota_bytes: number;
    measured_at: string;
    day: string;
    analytics_bytes: number | null;
    analytics_sampled_at: string | null;
    reconciled: string;
  }>("select * from r2_usage_daily where day = $1 and bucket = $2", [day, bucketName]);
  const cached = rows[0];
  if (cached) return rowToReading(cached);
  const reading = await measure(env);
  await saveReading(reading);
  return reading;
}
