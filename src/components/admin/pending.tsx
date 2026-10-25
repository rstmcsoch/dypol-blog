/** Instant skeleton shown inside the admin shell while a section's data loads. */
export function AdminPending() {
  return (
    <div className="adm-pending" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="adm-skel adm-skel--title" />
      <div className="adm-skel adm-skel--line" />
      <div className="adm-skel-grid">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="adm-skel adm-skel--card" />
        ))}
      </div>
      <div className="adm-skel adm-skel--block" />
    </div>
  );
}

/** Route options shared by every admin section: show the skeleton almost at once. */
export const adminPending = { pendingComponent: AdminPending, pendingMs: 80, pendingMinMs: 200 } as const;
