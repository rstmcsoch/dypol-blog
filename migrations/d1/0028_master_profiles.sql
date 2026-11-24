-- Multiple Master MCP agents: a profile can be promoted to "master" so it gets
-- the same draft-editing privileges as the default MCP_TOKEN profile, while
-- keeping its own token, name and audit trail. Default profile is master by
-- definition (env token) and has no row here.
alter table automation_profiles add column is_master integer not null default 0;
