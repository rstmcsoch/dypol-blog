import { createFileRoute, Link } from "@tanstack/react-router";
import { adminDashboard } from "@/content/admin-api";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/admin/")({
  loader: () => adminDashboard(),
  component: DeskHome,
});

function DeskHome() {
  const data = Route.useLoaderData();
  return (
    <>
      <p className="desk-kicker">Overview</p>
      <h1 className="desk-title">Dashboard</h1>
      <p className="desk-note">Live counts from your site.</p>
      <div className="stat-grid">
        <p className="stat">
          <strong>{data.counts.published}</strong>
          <span>Published</span>
        </p>
        <p className="stat">
          <strong>{data.counts.draft}</strong>
          <span>Drafts</span>
        </p>
        <p className="stat">
          <strong>{data.totalViews.toLocaleString()}</strong>
          <span>Total article views</span>
        </p>
        <p className="stat">
          <strong>{data.publishedThisWeek}</strong>
          <span>Published this week</span>
        </p>
        <p className="stat">
          <strong>{data.counts.scheduled}</strong>
          <span>Scheduled</span>
        </p>
        <p className="stat">
          <strong>{data.media.files}</strong>
          <span>{formatBytes(data.media.bytes)} in the library</span>
        </p>
      </div>
      <p className="adm-row-actions" style={{ marginTop: "1rem" }}>
        <Link to="/admin/articles/new" className="btn">New article</Link>
        <Link to="/admin/media" className="btn btn--ghost">Media library</Link>
        <Link to="/admin/automation" className="btn btn--ghost">AI automation</Link>
        <Link to="/admin/health" className="btn btn--ghost">Site health</Link>
      </p>
      <section className="desk-section">
        <h2>Top articles by views</h2>
        {data.topArticles.length === 0 ? (
          <p className="desk-note">No published articles yet.</p>
        ) : (
          <div className="desk-table-wrap">
            <table className="desk-table">
              <thead><tr><th>Title</th><th>Views</th><th>Words</th></tr></thead>
              <tbody>
                {data.topArticles.map((row) => (
                  <tr key={row.id}>
                    <td><Link to="/admin/articles/$id" params={{ id: row.id }}>{row.title}</Link></td>
                    <td>{row.views.toLocaleString()}</td>
                    <td>{row.words.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {data.recentRuns.length > 0 ? (
        <section className="desk-section">
          <h2>Recent automation runs</h2>
          <div className="desk-table-wrap">
            <table className="desk-table">
              <thead><tr><th>When</th><th>Tool</th><th>Outcome</th><th>Profile</th></tr></thead>
              <tbody>
                {data.recentRuns.map((run) => (
                  <tr key={run.id}>
                    <td>{formatDate(run.createdAt)}</td>
                    <td>{run.tool}</td>
                    <td>{run.outcome}</td>
                    <td>{run.profileId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      <section className="desk-section">
        <h2>Needs attention</h2>
        {data.attention.length === 0 ? (
          <p className="desk-note">No drafts or unpublished articles.</p>
        ) : (
          <ArticleTable rows={data.attention} />
        )}
      </section>
      <section className="desk-section">
        <h2>Recently updated</h2>
        <ArticleTable rows={data.recent} />
        <p style={{ marginTop: "1rem" }}>
          <Link to="/admin/articles/new" className="btn">
            New article
          </Link>
        </p>
      </section>
    </>
  );
}

function ArticleTable({
  rows,
}: {
  rows: {
    id: string;
    title: string;
    status: string;
    updatedAt: string;
    categoryLabel: string;
  }[];
}) {
  return (
    <div className="desk-table-wrap">
      <table className="desk-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Status</th>
            <th>Topic</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <Link to="/admin/articles/$id" params={{ id: row.id }}>
                  {row.title}
                </Link>
              </td>
              <td>
                <span className={row.status === "published" ? "desk-status desk-status--published" : "desk-status"}>
                  {row.status}
                </span>
              </td>
              <td>{row.categoryLabel}</td>
              <td>{formatDate(row.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
