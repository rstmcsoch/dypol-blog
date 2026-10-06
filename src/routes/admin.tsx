import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireDesk } from "@/components/admin/gate";
import { AdminShell } from "@/components/admin/shell";

export const Route = createFileRoute("/admin")({
  loader: () => requireDesk(),
  component: AdminLayout,
});

function AdminLayout() {
  const session = Route.useLoaderData();
  return (
    <AdminShell mode={session.mode} email={session.email}>
      <Outlet />
    </AdminShell>
  );
}
