import { createFileRoute } from "@tanstack/react-router";
import { adminActivity } from "@/content/admin-api";

export const Route = createFileRoute("/admin/activity")({
  loader: () => adminActivity(),
  component: ActivityDesk,
});

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function ActivityDesk() {
  const data = Route.useLoaderData();
  return (
    <>
      <p className="desk-kicker">System</p>
      <h1 className="desk-title">Activity</h1>
      <p className="desk-note">
        What happened recently: your admin actions and automation (AI) runs in one list, newest first. If an
        automation published or failed, it shows here with its reason.
      </p>

      <section className="panel" style={{ marginTop: "1rem" }}>
        <h2 className="panel-title">Recent activity</h2>
        {data.entries.length === 0 ? (
          <p className="desk-note">Nothing yet. Saving an article or an automation run will appear here.</p>
        ) : (
          <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {data.entries.map((e, i) => (
              <li key={`${e.at}-${i}`} style={{ display: "flex", gap: "0.6rem", alignItems: "baseline", flexWrap: "wrap" }}>
                <span className={`badge${e.source === "Automation" ? " badge--scheduled" : ""}`}>{e.source}</span>
                <span style={{ flex: 1, minWidth: 200 }}>{e.text}</span>
                <span className="desk-note">{when(e.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel" style={{ marginTop: "1rem" }}>
        <h2 className="panel-title">Broken links readers hit (404s)</h2>
        <p className="desk-note">
          Paths readers visited that do not exist, counted per path. Fix a recurring one by creating the page or
          correcting the link that points to it. Only real readers with JavaScript are counted — bots are not.
        </p>
        {data.notFounds.length === 0 ? (
          <p className="desk-note">No 404s recorded yet.</p>
        ) : (
          <div className="adm-scroll-x"><table className="table">
            <thead><tr><th>Path</th><th>Hits</th><th>Last seen</th><th>Came from</th></tr></thead>
            <tbody>
              {data.notFounds.map((n) => (
                <tr key={n.path}>
                  <td><code>{n.path}</code></td>
                  <td>{n.hits}</td>
                  <td>{when(n.lastSeen)}</td>
                  <td>{n.referrer ? <span style={{ wordBreak: "break-all" }}>{n.referrer}</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
