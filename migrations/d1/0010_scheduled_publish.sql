-- t68: scheduled publishing. A draft with scheduled_at set is flipped
-- to published (published_at = scheduled_at) by the request-time sweep
-- once its time passes. Additive; null = not scheduled.
alter table articles add column scheduled_at text;
create index if not exists idx_articles_scheduled on articles (status, scheduled_at);
