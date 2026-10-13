import type { AutomationSchemaStatus } from "@/lib/automation/schema";

export function AutomationSchemaNotice({ schema, environment }: { schema: AutomationSchemaStatus; environment: string }) {
  const missing = [
    ...schema.missingTables.map((table) => `table ${table}`),
    ...schema.missingColumns.flatMap(({ table, columns }) => columns.map((column) => `column ${table}.${column}`)),
  ];

  return (
    <>
      <p className="desk-kicker">Automation</p>
      <h1 className="desk-title">Automation storage needs an update</h1>
      <p className="desk-note">The desk checked the database bound to this deployment before reading or changing automation data.</p>
      <section className="desk-section" aria-labelledby="automation-schema-title">
        <div className="banner banner--bad" role="alert">
          <h2 id="automation-schema-title">Required D1 schema is missing</h2>
          <p>
            Environment: <strong>{environment || "unknown"}</strong>. Missing {missing.length ? missing.map((item, index) => <span key={item}>{index ? ", " : ""}<code>{item}</code></span>) : "required automation tables or columns"}.
          </p>
          <p>
            The code suggests {schema.migrations.length ? schema.migrations.join(" and ") : "the pending automation migrations"} from <code>migrations/d1</code>. First verify this environment's D1 binding and migration tracker, then apply only migrations that are still pending to that same database. If a migration is marked applied but its objects are absent, stop and verify the binding/state before making a forward-only repair. This check changed nothing; do not reset or recreate the database.
          </p>
          <button className="btn btn--ghost" type="button" onClick={() => window.location.reload()}>
            Check again
          </button>
        </div>
      </section>
    </>
  );
}
