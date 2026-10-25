import { createFileRoute } from "@tanstack/react-router";
import { adminMessages } from "@/content/admin-api";

export const Route = createFileRoute("/admin/messages")({
  loader: () => adminMessages(),
  component: MessagesDesk,
});

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
}

function MessagesDesk() {
  const { messages } = Route.useLoaderData();
  return (
    <>
      <p className="desk-kicker">Content</p>
      <h1 className="desk-title">Messages</h1>
      <p className="desk-note">Messages sent through the contact form (verified by Cloudflare Turnstile), newest first. Times in IST.</p>
      <section className="panel" style={{ marginTop: "1rem" }}>
        {messages.length === 0 ? (
          <p className="desk-note">No messages yet.</p>
        ) : (
          <div className="adm-scroll-x"><table className="table">
            <thead><tr><th>Received</th><th>From</th><th>Message</th></tr></thead>
            <tbody>
              {messages.map((m) => (
                <tr key={m.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{when(m.createdAt)}</td>
                  <td>
                    <strong>{m.name}</strong>
                    <br />
                    <a href={`mailto:${m.email}`}>{m.email}</a>
                  </td>
                  <td style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.message}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
