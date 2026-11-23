/**
 * Official Master MCP tool catalog (pure). Names, groups, hints and the
 * publishing-profile task tools. Implementations live in master-tools.server.ts.
 */
export type ToolHint = { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };

export type CatalogEntry = { name: string; group: string; title: string; hints: ToolHint };

export const MASTER_TOOL_CATALOG: readonly CatalogEntry[] = [
  { name: "get_master_overview", group: "system", title: "Master overview", hints: { readOnlyHint: true, idempotentHint: true } },
  { name: "get_site_health", group: "system", title: "Site health", hints: { readOnlyHint: true, idempotentHint: true } },
  { name: "get_activity_feed", group: "system", title: "Activity feed", hints: { readOnlyHint: true, idempotentHint: true } },
  { name: "get_daily_publishing_report", group: "system", title: "Daily publishing report", hints: { readOnlyHint: true, idempotentHint: true } },
  { name: "get_master_permissions", group: "system", title: "Master permissions", hints: { readOnlyHint: true, idempotentHint: true } },

  { name: "list_all_articles", group: "articles", title: "List all articles", hints: { readOnlyHint: true, idempotentHint: true } },
  { name: "get_full_article", group: "articles", title: "Get full article", hints: { readOnlyHint: true, idempotentHint: true } },
  { name: "create_article", group: "articles", title: "Create article", hints: { destructiveHint: false } },
  { name: "update_article", group: "articles", title: "Update article", hints: { destructiveHint: false, idempotentHint: true } },
  { name: "publish_article", group: "articles", title: "Publish article", hints: { idempotentHint: true } },
  { name: "schedule_article", group: "articles", title: "Schedule article", hints: { idempotentHint: true } },
  { name: "unpublish_article", group: "articles", title: "Unpublish article", hints: { idempotentHint: true } },
  { name: "duplicate_article", group: "articles", title: "Duplicate article", hints: { destructiveHint: false } },
  { name: "preview_article_deletion", group: "articles", title: "Preview article deletion", hints: { readOnlyHint: true } },
  { name: "delete_article", group: "articles", title: "Delete article", hints: { destructiveHint: true, idempotentHint: true } },
  { name: "set_article_ai_edit_permission", group: "articles", title: "Set AI-edit permission", hints: { idempotentHint: true } },
  { name: "list_article_revisions", group: "articles", title: "List article revisions", hints: { readOnlyHint: true, idempotentHint: true } },
  { name: "restore_article_revision", group: "articles", title: "Restore article revision", hints: { destructiveHint: false } },

  { name: "list_automation_profiles", group: "automation", title: "List automation profiles", hints: { readOnlyHint: true, idempotentHint: true } },
  { name: "get_automation_profile", group: "automation", title: "Get automation profile", hints: { readOnlyHint: true, idempotentHint: true } },
  { name: "update_automation_profile", group: "automation", title: "Update automation profile", hints: { idempotentHint: true } },
  { name: "set_automation_status", group: "automation", title: "Set automation status", hints: { idempotentHint: true } },
  { name: "update_automation_publishing_limits", group: "automation", title: "Update publishing limits", hints: { idempotentHint: true } },
  { name: "update_automation_topics", group: "automation", title: "Update automation topics", hints: { idempotentHint: true } },
  { name: "update_automation_sources", group: "automation", title: "Update automation sources", hints: { idempotentHint: true } },
  { name: "update_automation_schedule", group: "automation", title: "Update automation schedule", hints: { idempotentHint: true } },
  { name: "manage_automation_authors", group: "automation", title: "Manage automation authors", hints: { idempotentHint: true } },
  { name: "get_automation_usage", group: "automation", title: "Get automation usage", hints: { readOnlyHint: true, idempotentHint: true } },

  { name: "assign_agent_task", group: "tasks", title: "Assign agent task", hints: { destructiveHint: false } },
  { name: "list_agent_tasks", group: "tasks", title: "List agent tasks", hints: { readOnlyHint: true, idempotentHint: true } },
  { name: "get_agent_task", group: "tasks", title: "Get agent task", hints: { readOnlyHint: true, idempotentHint: true } },
  { name: "update_agent_task", group: "tasks", title: "Update agent task", hints: { idempotentHint: true } },
  { name: "cancel_agent_task", group: "tasks", title: "Cancel agent task", hints: { destructiveHint: true, idempotentHint: true } },
  { name: "get_agent_task_results", group: "tasks", title: "Get agent task results", hints: { readOnlyHint: true, idempotentHint: true } },

  { name: "get_website_settings", group: "config", title: "Get website settings", hints: { readOnlyHint: true, idempotentHint: true } },
  { name: "update_website_settings", group: "config", title: "Update website settings", hints: { idempotentHint: true } },
  { name: "get_homepage_configuration", group: "config", title: "Get homepage configuration", hints: { readOnlyHint: true, idempotentHint: true } },
  { name: "update_homepage_configuration", group: "config", title: "Update homepage configuration", hints: { idempotentHint: true } },
  { name: "update_site_text", group: "config", title: "Update site text", hints: { idempotentHint: true } },
  { name: "update_appearance", group: "config", title: "Update appearance", hints: { idempotentHint: true } },
  { name: "manage_pages", group: "config", title: "Manage pages", hints: {} },
  { name: "manage_topics", group: "config", title: "Manage topics", hints: {} },
  { name: "manage_tags", group: "config", title: "Manage tags", hints: {} },
  { name: "manage_ticker", group: "config", title: "Manage ticker", hints: { idempotentHint: true } },
  { name: "manage_events", group: "config", title: "Manage events", hints: {} },
  { name: "manage_media", group: "config", title: "Manage media", hints: {} },
  { name: "manage_ads", group: "config", title: "Manage ads", hints: {} },
  { name: "list_contact_messages", group: "config", title: "List contact messages", hints: { readOnlyHint: false } },

  { name: "get_analytics_overview", group: "analytics", title: "Analytics overview", hints: { readOnlyHint: true, idempotentHint: true } },
  { name: "get_article_analytics", group: "analytics", title: "Article analytics", hints: { readOnlyHint: true, idempotentHint: true } },
  { name: "get_topic_analytics", group: "analytics", title: "Topic analytics", hints: { readOnlyHint: true, idempotentHint: true } },
  { name: "get_traffic_sources", group: "analytics", title: "Traffic sources", hints: { readOnlyHint: true, idempotentHint: true } },
  { name: "get_automation_analytics", group: "analytics", title: "Automation analytics", hints: { readOnlyHint: true, idempotentHint: true } },
  { name: "get_publishing_history", group: "analytics", title: "Publishing history", hints: { readOnlyHint: true, idempotentHint: true } },
] as const;

/** Tools added to ordinary publishing MCP connections so they can collect assigned work. */
export const PUBLISHER_TASK_TOOLS: readonly CatalogEntry[] = [
  { name: "list_my_agent_tasks", group: "tasks", title: "List my assigned tasks", hints: { readOnlyHint: true, idempotentHint: true } },
  { name: "claim_agent_task", group: "tasks", title: "Claim an assigned task", hints: { idempotentHint: false } },
  { name: "report_agent_task", group: "tasks", title: "Report task result", hints: { idempotentHint: true } },
] as const;

export const MASTER_TOOL_NAMES = MASTER_TOOL_CATALOG.map((t) => t.name);
export const PUBLISHER_TASK_TOOL_NAMES = PUBLISHER_TASK_TOOLS.map((t) => t.name);
