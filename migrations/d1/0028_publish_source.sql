-- t241: record how an article was created and first published (MCP client vs
-- Manual admin). Additive, nullable. Existing rows stay unset unless a
-- successful automation run can be matched. Never invent a manual source.
alter table articles add column created_via text;
alter table articles add column created_via_client text;
alter table articles add column created_via_product text;
alter table articles add column published_via text;
alter table articles add column published_via_client text;
alter table articles add column published_via_product text;

-- Backfill first-publish source from the earliest successful MCP publish run.
update articles
set
  published_via = (
    select case
      when r.auth like 'oauth:%' then 'mcp-oauth'
      when r.auth = 'oauth' then 'mcp-oauth'
      when r.auth = 'bearer' then 'mcp-bearer'
      when r.auth = 'profile-token' then 'mcp-profile-token'
      else 'mcp'
    end
    from automation_runs r
    where r.article_id = articles.id
      and r.tool = 'publish_article_if_allowed'
      and r.outcome in ('published', 'published_explicit')
    order by r.created_at asc
    limit 1
  ),
  published_via_client = (
    select case
      when r.auth like 'oauth:%' then nullif(trim(substr(r.auth, 7)), '')
      when r.auth = 'oauth' then 'legacy connector'
      else null
    end
    from automation_runs r
    where r.article_id = articles.id
      and r.tool = 'publish_article_if_allowed'
      and r.outcome in ('published', 'published_explicit')
    order by r.created_at asc
    limit 1
  )
where published_via is null
  and exists (
    select 1 from automation_runs r
    where r.article_id = articles.id
      and r.tool = 'publish_article_if_allowed'
      and r.outcome in ('published', 'published_explicit')
  );

-- Backfill created source from the earliest accepted draft submission.
update articles
set
  created_via = (
    select case
      when r.auth like 'oauth:%' then 'mcp-oauth'
      when r.auth = 'oauth' then 'mcp-oauth'
      when r.auth = 'bearer' then 'mcp-bearer'
      when r.auth = 'profile-token' then 'mcp-profile-token'
      else 'mcp'
    end
    from automation_runs r
    where r.article_id = articles.id
      and r.tool = 'submit_article_draft'
      and r.outcome = 'drafted'
    order by r.created_at asc
    limit 1
  ),
  created_via_client = (
    select case
      when r.auth like 'oauth:%' then nullif(trim(substr(r.auth, 7)), '')
      when r.auth = 'oauth' then 'legacy connector'
      else null
    end
    from automation_runs r
    where r.article_id = articles.id
      and r.tool = 'submit_article_draft'
      and r.outcome = 'drafted'
    order by r.created_at asc
    limit 1
  )
where created_via is null
  and exists (
    select 1 from automation_runs r
    where r.article_id = articles.id
      and r.tool = 'submit_article_draft'
      and r.outcome = 'drafted'
  );
