-- t116: GA4-style key events (internal article-link clicks) per read, and
-- visitor country (ISO code only, from Cloudflare's request.cf.country; no IP stored).
alter table analytics_article_session add column key_events integer not null default 0;
alter table analytics_sessions add column country text;
