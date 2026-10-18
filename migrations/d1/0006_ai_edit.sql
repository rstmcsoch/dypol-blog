-- AI draft editing: per-article admin grant letting AI (via MCP) edit one
-- specific PUBLISHED article. Default off. Additive only; code reads it
-- defensively (missing column = no grants) until this migration is applied.
alter table articles add column ai_edit_allowed integer not null default 0;
