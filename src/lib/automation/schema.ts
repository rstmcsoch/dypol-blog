import type { Sql } from "@/lib/db";

/**
 * Automation storage is deliberately migrated with versioned D1 SQL files; it
 * is never created as a side effect of opening the desk or running a job. This
 * read-only preflight turns a partially deployed schema into a useful diagnostic
 * instead of letting an entire admin route fail with an opaque SQLite error.
 */

const REQUIRED_COLUMNS = {
  automations: [
    "id",
    "name",
    "enabled",
    "paused",
    "mode",
    "provider",
    "model",
    "base_url",
    "credential_ref",
    "topic_source",
    "topic_ideas",
    "topic_sources",
    "category_id",
    "tag_ids",
    "language",
    "style",
    "instructions",
    "min_words",
    "image_mode",
    "image_prompt",
    "publish_mode",
    "schedule_cron",
    "timezone",
    "max_per_day",
    "retry_max",
    "retry_backoff_seconds",
    "require_sources",
    "min_sources",
    "require_cover",
    "allowed_category_ids",
    "mcp_default",
    "sort_order",
    "created_at",
    "updated_at",
  ],
  automation_schedule: [
    "automation_id",
    "next_run_at",
    "last_run_at",
    "last_status",
    "last_reason",
    "locked_until",
    "lock_token",
    "failure_streak",
    "updated_at",
  ],
  automation_runs: [
    "id",
    "created_at",
    "tool",
    "outcome",
    "reason",
    "article_id",
    "auth",
    "details",
    "automation_id",
    "stage",
    "status",
    "duration_ms",
    "attempt",
    "finished_at",
  ],
  automation_submissions: [
    "idempotency_key",
    "content_hash",
    "article_id",
    "source_urls",
    "flags",
    "provider",
    "created_at",
  ],
} as const satisfies Record<string, readonly string[]>;

export type AutomationSchemaStatus = {
  ready: boolean;
  missingTables: string[];
  missingColumns: { table: string; columns: string[] }[];
  migrations: string[];
};

export class AutomationSchemaNotReadyError extends Error {
  readonly status = 503;
  readonly code = "AUTOMATION_SCHEMA_NOT_READY";
  readonly schema: AutomationSchemaStatus;
  readonly environment: string;

  constructor(schema: AutomationSchemaStatus, environment = "unknown") {
    const safeEnvironment = /^[a-z0-9_-]{1,40}$/i.test(environment) ? environment : "unknown";
    super(automationSchemaMessage(schema, safeEnvironment));
    this.name = "AutomationSchemaNotReadyError";
    this.schema = schema;
    this.environment = safeEnvironment;
  }
}

/** Read-only validation of the exact tables/columns used by the desk and jobs. */
export async function inspectAutomationSchema(sql: Pick<Sql, "query">): Promise<AutomationSchemaStatus> {
  const tables = await sql.query<{ name: string }>("select name from sqlite_master where type = 'table'");
  const existingTables = new Set(tables.map((table) => table.name));
  const missingTables: string[] = [];
  const missingColumns: { table: string; columns: string[] }[] = [];

  for (const [table, requiredColumns] of Object.entries(REQUIRED_COLUMNS)) {
    if (!existingTables.has(table)) {
      missingTables.push(table);
      continue;
    }
    // `table` comes only from the fixed allow-list above, never from a request.
    const rows = await sql.query<{ name: string }>(`pragma table_info("${table}")`);
    const existingColumns = new Set(rows.map((column) => column.name));
    const missing = requiredColumns.filter((column) => !existingColumns.has(column));
    if (missing.length > 0) missingColumns.push({ table, columns: [...missing] });
  }

  const migrations = new Set<string>();
  if (missingTables.includes("automation_submissions")) migrations.add("0003_automation.sql");
  if (
    missingTables.some((table) => table === "automations" || table === "automation_schedule") ||
    missingColumns.some((item) => item.table === "automation_runs" || item.table === "automations" || item.table === "automation_schedule")
  ) {
    migrations.add("0004_automations.sql");
  }
  if (missingTables.includes("automation_runs")) {
    migrations.add("0003_automation.sql");
    migrations.add("0004_automations.sql");
  }

  return {
    ready: missingTables.length === 0 && missingColumns.length === 0,
    missingTables,
    missingColumns,
    migrations: [...migrations].sort(),
  };
}

export function automationSchemaMessage(schema: AutomationSchemaStatus, environment = "unknown"): string {
  const missing = [
    ...schema.missingTables.map((table) => `table ${table}`),
    ...schema.missingColumns.flatMap(({ table, columns }) => columns.map((column) => `column ${table}.${column}`)),
  ];
  const problem = missing.length ? missing.join(", ") : "required automation schema objects";
  const migrations = schema.migrations.length ? schema.migrations.join(" and ") : "the pending automation migrations";
  return `Automation storage is not ready on the ${environment} deployment's D1 database: missing ${problem}. Suggested migration(s): ${migrations}. Verify the D1 binding and migration tracker for this environment, then apply only the pending migration(s) to that database. If a migration is already recorded as applied but its objects are absent, stop and verify the binding/state before creating a forward-only repair. This check made no database changes; do not reset or recreate the database.`;
}

export async function assertAutomationSchemaReady(sql: Pick<Sql, "query">, environment = "unknown"): Promise<AutomationSchemaStatus> {
  const schema = await inspectAutomationSchema(sql);
  if (!schema.ready) throw new AutomationSchemaNotReadyError(schema, environment);
  return schema;
}
