import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { assertAutomationSchemaReady, AutomationSchemaNotReadyError, inspectAutomationSchema } from "./schema.ts";

const columns: Record<string, string[]> = {
  automations: [
    "id", "name", "enabled", "paused", "mode", "provider", "model", "base_url", "credential_ref", "topic_source",
    "topic_ideas", "topic_sources", "category_id", "tag_ids", "language", "style", "instructions", "min_words",
    "image_mode", "image_prompt", "publish_mode", "schedule_cron", "timezone", "max_per_day", "retry_max",
    "retry_backoff_seconds", "require_sources", "min_sources", "require_cover", "allowed_category_ids", "mcp_default",
    "sort_order", "created_at", "updated_at",
  ],
  automation_schedule: [
    "automation_id", "next_run_at", "last_run_at", "last_status", "last_reason", "locked_until", "lock_token", "failure_streak", "updated_at",
  ],
  automation_runs: [
    "id", "created_at", "tool", "outcome", "reason", "article_id", "auth", "details", "automation_id", "stage", "status", "duration_ms", "attempt", "finished_at",
  ],
  automation_submissions: ["idempotency_key", "content_hash", "article_id", "source_urls", "flags", "provider", "created_at"],
};

type MockSql = {
  query<T = Record<string, unknown>>(text: string): Promise<T[]>;
};

function mockSql(schema: Record<string, string[]> = columns): MockSql {
  return {
    async query<T>(text: string): Promise<T[]> {
      if (text.startsWith("select name from sqlite_master")) {
        return Object.keys(schema).map((name) => ({ name })) as T[];
      }
      const match = /^pragma table_info\("([a-z_]+)"\)$/.exec(text);
      if (!match) throw new Error(`Unexpected schema query: ${text}`);
      return (schema[match[1]] ?? []).map((name) => ({ name })) as T[];
    },
  };
}

test("the automation schema preflight accepts all objects used by the desk", async () => {
  const status = await inspectAutomationSchema(mockSql());
  assert.deepEqual(status, { ready: true, missingTables: [], missingColumns: [], migrations: [] });
});

test("an empty automation schema requires the complete ordered migration pair", async () => {
  const status = await inspectAutomationSchema(mockSql({}));
  assert.equal(status.ready, false);
  assert.deepEqual(status.missingTables, ["automations", "automation_schedule", "automation_runs", "automation_submissions"]);
  assert.deepEqual(status.migrations, ["0003_automation.sql", "0004_automations.sql"]);
});

test("the schedule migration is additive and never drops or recreates a table", async () => {
  const migration = await readFile(new URL("../../../migrations/d1/0004_automations.sql", import.meta.url), "utf8");
  assert.match(migration, /create table if not exists automation_schedule/i);
  assert.doesNotMatch(migration, /\bdrop\s+(?:table|database)\b|\btruncate\s+table\b/i);
});

test("a missing schedule table reports the additive migration without mutating the database", async () => {
  const { automation_schedule: _missing, ...partial } = columns;
  const status = await inspectAutomationSchema(mockSql(partial));
  assert.equal(status.ready, false);
  assert.deepEqual(status.missingTables, ["automation_schedule"]);
  assert.deepEqual(status.migrations, ["0004_automations.sql"]);
});

test("missing run-history columns are reported instead of silently returning an empty log", async () => {
  const legacyRunColumns = columns.automation_runs.filter((column) => !["automation_id", "stage", "status"].includes(column));
  const status = await inspectAutomationSchema(mockSql({ ...columns, automation_runs: legacyRunColumns }));
  assert.equal(status.ready, false);
  assert.deepEqual(status.missingColumns, [{ table: "automation_runs", columns: ["automation_id", "stage", "status"] }]);
  assert.deepEqual(status.migrations, ["0004_automations.sql"]);
});

test("the error given to an authorized caller contains actionable schema details only", async () => {
  const { automation_schedule: _missing, ...partial } = columns;
  await assert.rejects(
    () => assertAutomationSchemaReady(mockSql(partial), "preview"),
    (error: unknown) => {
      assert.ok(error instanceof AutomationSchemaNotReadyError);
      assert.equal(error.status, 503);
      assert.equal(error.environment, "preview");
      assert.match(error.message, /preview deployment/);
      assert.match(error.message, /table automation_schedule/);
      assert.match(error.message, /0004_automations\.sql/);
      assert.match(error.message, /do not reset or recreate/i);
      assert.doesNotMatch(error.message, /secret|token|password/i);
      return true;
    },
  );
});
