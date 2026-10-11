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
      <h1 className="desk-title">Desk</h1>
      <p className="desk-note">Counts come from the journal store. Nothing here is a sample number.</p>
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
          <strong>{data.counts.unpublished}</strong>
          <span>Unpublished</span>
        </p>
        <p className="stat">
          <strong>{data.media.files}</strong>
          <span>{formatBytes(data.media.bytes)} in the library</span>
        </p>
      </div>
      <section className="desk-section">
        <h2>Needs attention</h2>
        {data.attention.length === 0 ? (
          <p className="desk-note">No drafts or unpublished pieces.</p>
        ) : (
          <PieceTable rows={data.attention} />
        )}
      </section>
      <section className="desk-section">
        <h2>Recently updated</h2>
        <PieceTable rows={data.recent} />
        <p style={{ marginTop: "1rem" }}>
          <Link to="/admin/articles/new" className="btn">
            New piece
          </Link>
        </p>
      </section>
    </>
  );
}

function PieceTable({
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
