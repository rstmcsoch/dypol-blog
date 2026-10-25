import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getDeskSession } from "@/components/admin/gate";
import { AdminShell } from "@/components/admin/shell";
import { AdminSignIn } from "@/components/admin/sign-in";
import { sitePageTitle } from "@/lib/seo";
import { cachedDesk, rememberDesk } from "@/components/admin/desk-cache";

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
    // Client-side section switches reuse the recent signed-in result instead of
    // a blocking server round trip before every child loader. Every admin server
    // function still verifies the session cookie itself.
    const desk = cachedDesk() ?? rememberDesk(await getDeskSession());
    if (!desk.session && location.pathname !== "/admin" && location.pathname !== "/admin/") {
      throw redirect({ to: "/admin", search: { denied: desk.locked } });
    }
    return { desk };
  },
  loader: ({ context }) => context.desk,
  head: () => ({
    meta: [
      { title: sitePageTitle("Admin") },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminLayout,
});

function AdminLayout() {
  const desk = Route.useLoaderData();
  const { session, locked } = desk;
  rememberDesk(desk);
  const { denied } = Route.useSearch();
  if (!session) return <AdminSignIn denied={denied || locked} />;
  return (
    <AdminShell mode={session.mode} email={session.email}>
      <Outlet />
    </AdminShell>
  );
}
