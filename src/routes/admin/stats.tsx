import { createFileRoute } from "@tanstack/react-router";
import { StatsDesk } from "@/components/admin/stats-desk";
import { adminEditorialStats } from "@/content/admin-api";

export const Route = createFileRoute("/admin/stats")({
  loader: async ({ context }) => {
    if (!(context as { desk?: { session: unknown } }).desk?.session) return null;
    return adminEditorialStats({ data: { preset: "28d" } });
  },
  pendingComponent: StatsPending,
  component: StatsRoute,
});

function StatsRoute() {
  const data = Route.useLoaderData();
  if (!data) return null;
  return <StatsDesk initial={data} />;
}

function StatsPending() {
  return (
    <div className="stats" aria-busy="true">
      <p className="desk-kicker">Audience</p>
      <h1 className="desk-title">Stats</h1>
      <p className="desk-note">Loading the reporting period…</p>
      <div className="stat-grid">
        {Array.from({ length: 4 }, (_, index) => <div key={index} className="stats-skel" />)}
      </div>
    </div>
  );
}
