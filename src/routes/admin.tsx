import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getDeskSession } from "@/components/admin/gate";
import { AdminShell } from "@/components/admin/shell";
import { AdminSignIn } from "@/components/admin/sign-in";

export const Route = createFileRoute("/admin")({
  // Optional on purpose: a required parent search param would be inherited
  // by every /admin/* child route and break all their links.
  validateSearch: (search: Record<string, unknown>): { denied?: boolean } => ({
    denied: search.denied === true || search.denied === "true" || search.denied === "1" ? true : undefined,
  }),
  // Runs before any child loader: an unauthenticated deep link
  // (/admin/articles/...) lands on the single sign-in entry at /admin,
  // and child loaders never fire without a session.
  beforeLoad: async ({ location }) => {
    const desk = await getDeskSession();
    if (!desk.session && location.pathname !== "/admin" && location.pathname !== "/admin/") {
      throw redirect({ to: "/admin", search: { denied: desk.locked } });
    }
    return { desk };
  },
  loader: ({ context }) => context.desk,
  head: () => ({
    meta: [
      { title: "Admin — DYPOL Blog" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminLayout,
});

function AdminLayout() {
  const { session, locked } = Route.useLoaderData();
  const { denied } = Route.useSearch();
  if (!session) return <AdminSignIn denied={denied || locked} />;
  return (
    <AdminShell mode={session.mode} email={session.email}>
      <Outlet />
    </AdminShell>
  );
}
