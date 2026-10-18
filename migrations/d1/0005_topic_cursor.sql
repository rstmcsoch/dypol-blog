-- Per-profile topic-selection cursor (sequence mode). One row per profile;
-- 'default' is the master-token profile. Code degrades gracefully (cursor 0)
-- until this migration is applied.
create table if not exists automation_topic_state (
  profile_id text primary key,
  cursor integer not null default 0,
  updated_at text not null
);
