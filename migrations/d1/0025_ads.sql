-- t148: advertising. One JSON settings row (slots, sponsors, scripts, rules),
-- per-slot version history, an audit log and daily counters.
create table if not exists ads_settings (id text primary key, data text not null, updated_at text not null, updated_by text);
create table if not exists ads_versions (id text primary key, slot_id text not null, data text not null, created_at text not null, actor text);
create index if not exists ads_versions_slot on ads_versions (slot_id, created_at);
create table if not exists ads_audit (id text primary key, created_at text not null, actor text, action text not null, detail text not null);
create index if not exists ads_audit_at on ads_audit (created_at);
create table if not exists ad_stats (day text not null, slot_id text not null, creative_id text not null, sponsor_id text not null default '', impressions integer not null default 0, clicks integer not null default 0, primary key (day, slot_id, creative_id));
