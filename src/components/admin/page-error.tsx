import type { ErrorComponentProps } from "@tanstack/react-router";

/** A useful, non-sensitive fallback for an admin loader/action route failure. */
export function AdminPageError({ error }: ErrorComponentProps) {
  const raw = error instanceof Error ? error.message : "";
  const missingTable = /no such table:\s*["`]?([a-zA-Z0-9_]+)["`]?/i.exec(raw)?.[1];
  const missingColumn = /no such column:\s*["`]?([a-zA-Z0-9_.]+)["`]?/i.exec(raw)?.[1];
  const issue = missingTable ? `The bound D1 database is missing the ${missingTable} table.` : missingColumn ? `The bound D1 database is missing the ${missingColumn} column.` : null;

  return (
    <section className="admin-page-error" role="alert" aria-labelledby="admin-page-error-title">
      <p className="desk-kicker">Admin</p>
      <h1 className="desk-title" id="admin-page-error-title">This page could not load</h1>
      <p className="desk-note">
        {issue
          ? `${issue} Verify this deployment's D1 binding and migration tracker first, then apply only migrations still pending to that database. If the tracker says a migration was applied, stop and investigate the binding/schema state before creating a forward-only repair. Do not reset or recreate the database.`
          : "The admin request did not complete. Reload this page; if it keeps failing, check the deployment's database binding, migration tracker and Worker logs. Do not reset or recreate the database to clear an error."}
      </p>
      <button className="btn btn--ghost" type="button" onClick={() => window.location.reload()}>
        Reload page
      </button>
    </section>
  );
}
