-- Daily exact listing of the article media bucket (R2).
-- One row per IST day. payload_bytes is the sum of object sizes, which is
-- the same number Cloudflare reports as R2 payloadSize.
create table if not exists r2_usage_daily (
  day text primary key,
  bucket text not null,
  payload_bytes integer not null,
  object_count integer not null,
  quota_bytes integer not null,
  measured_at text not null,
  analytics_bytes integer,
  analytics_sampled_at text,
  reconciled text not null
);
