import { createFileRoute, Outlet, type ErrorComponentProps } from "@tanstack/react-router";
import { requireDesk } from "@/components/admin/gate";
import { AdminShell } from "@/components/admin/shell";

export const Route = createFileRoute("/admin")({
  loader: () => requireDesk(),
  component: AdminLayout,
  // A desk page that cannot load (most often: the database is unreachable)
  // must still look like the desk, and must say what to do next.
  errorComponent: DeskError,
});

function DeskError({ error }: ErrorComponentProps) {
  const message = error instanceof Error && error.message ? error.message : "The desk could not load this page.";
  return (
    <div className="desk" data-theme="light">
      <main className="desk-main">
        <div className="adm-content">
          <p className="desk-kicker">Admin</p>
          <h1 className="desk-title">This page could not load</h1>
          <p className="desk-note" role="alert">
            {message}
          </p>
          <p className="desk-note">
            If the database is unreachable, the public site keeps working from its built-in content and this page will load
            again once the database answers.
          </p>
          <p className="desk-note">
            <a className="btn" href="/admin">
              Try again
            </a>{" "}
            <a className="btn btn--ghost" href="/">
              View site
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}

function AdminLayout() {
  const session = Route.useLoaderData();
  return (
    <AdminShell mode={session.mode} email={session.email} theme={session.theme}>
      <Outlet />
    </AdminShell>
  );
}
