import { useState } from "react";
import { adminPending } from "@/components/admin/pending";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { errorText } from "@/components/admin/gate";
import { adminSaveTeam, adminTeam } from "@/content/admin-api";
import { createTeamId, teamMemberCount, type TeamGroup, type TeamMember, type TeamSettings } from "@/lib/team";

export const Route = createFileRoute("/admin/team")({
  ...adminPending,
  loader: () => adminTeam(),
  component: TeamDesk,
});

function clone(settings: TeamSettings): TeamSettings {
  return JSON.parse(JSON.stringify(settings)) as TeamSettings;
}

function move<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function TeamDesk() {
  const loaded = Route.useLoaderData();
  const router = useRouter();
  const [draft, setDraft] = useState<TeamSettings>(() => clone(loaded));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await adminSaveTeam({ data: draft });
      setDraft(clone(saved));
      setMessage("Team page saved.");
      await router.invalidate();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const setGroup = (gi: number, patch: Partial<TeamGroup>) =>
    setDraft((d) => ({ ...d, groups: d.groups.map((g, i) => (i === gi ? { ...g, ...patch } : g)) }));

  const setMember = (gi: number, mi: number, patch: Partial<TeamMember>) =>
    setDraft((d) => ({
      ...d,
      groups: d.groups.map((g, i) =>
        i === gi ? { ...g, members: g.members.map((m, j) => (j === mi ? { ...m, ...patch } : m)) } : g,
      ),
    }));

  const addGroup = () =>
    setDraft((d) => ({
      ...d,
      groups: [
        ...d.groups,
        {
          id: createTeamId("g"),
          kicker: "New group",
          title: "Group title",
          note: "",
          members: [],
        },
      ],
    }));

  const removeGroup = (gi: number) => {
    if (!window.confirm("Remove this group and all its members?")) return;
    setDraft((d) => ({ ...d, groups: d.groups.filter((_, i) => i !== gi) }));
  };

  const addMember = (gi: number) =>
    setDraft((d) => ({
      ...d,
      groups: d.groups.map((g, i) =>
        i === gi ? { ...g, members: [...g.members, { id: createTeamId("m"), name: "", role: "" }] } : g,
      ),
    }));

  const removeMember = (gi: number, mi: number) =>
    setDraft((d) => ({
      ...d,
      groups: d.groups.map((g, i) => (i === gi ? { ...g, members: g.members.filter((_, j) => j !== mi) } : g)),
    }));

  return (
    <>
      <p className="desk-kicker">Site / Pages</p>
      <h1 className="desk-title">Team page</h1>
      <p className="desk-note">
        Manage the public <Link to="/team">/team</Link> page. Add, edit, remove and reorder groups and members. Changes are saved to the site and appear on the live team page.
      </p>
      <p className="desk-note">
        <Link to="/admin/pages">← Back to Pages</Link>
      </p>
      {error ? <p className="banner banner--bad" role="alert">{error}</p> : null}
      {message ? <p className="banner" role="status">{message}</p> : null}

      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <section className="desk-section">
          <h2>Page header</h2>
          <div className="block-card">
            <label className="field"><span>Kicker</span><input value={draft.kicker} onChange={(e) => setDraft({ ...draft, kicker: e.target.value })} maxLength={120} required /></label>
            <label className="field"><span>Title</span><input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={200} required /></label>
            <label className="field"><span>Intro / lede</span><textarea value={draft.lede} onChange={(e) => setDraft({ ...draft, lede: e.target.value })} maxLength={500} rows={3} required /></label>
            <label className="field"><span>Editorial note (optional, shown at bottom)</span><textarea value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} maxLength={500} rows={3} /></label>
            <p className="desk-note" style={{ marginBottom: 0 }}>{teamMemberCount(draft)} people across {draft.groups.length} group{draft.groups.length === 1 ? "" : "s"}.</p>
          </div>
        </section>

        <section className="desk-section">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>Groups & members</h2>
            <button type="button" className="btn" onClick={addGroup}>Add group</button>
          </div>
          <p className="desk-note">Groups appear in order on the public team page. Within each group, members appear in order. Use Move up/down to reorder.</p>

          {draft.groups.map((group, gi) => (
            <div key={group.id} className="block-card" style={{ display: "grid", gap: "1rem" }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                <strong>{group.kicker || `Group ${gi + 1}`}</strong>
                <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
                  <button type="button" className="btn btn--sm" disabled={gi === 0} onClick={() => setDraft((d) => ({ ...d, groups: move(d.groups, gi, gi - 1) }))}>Move up</button>
                  <button type="button" className="btn btn--sm" disabled={gi === draft.groups.length - 1} onClick={() => setDraft((d) => ({ ...d, groups: move(d.groups, gi, gi + 1) }))}>Move down</button>
                  <button type="button" className="btn btn--sm btn--danger" onClick={() => removeGroup(gi)}>Remove group</button>
                </div>
              </div>

              <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                <label className="field"><span>Group kicker</span><input value={group.kicker} onChange={(e) => setGroup(gi, { kicker: e.target.value })} maxLength={120} required /></label>
                <label className="field"><span>Group title</span><input value={group.title} onChange={(e) => setGroup(gi, { title: e.target.value })} maxLength={200} required /></label>
              </div>
              <label className="field"><span>Group note (optional)</span><input value={group.note} onChange={(e) => setGroup(gi, { note: e.target.value })} maxLength={300} /></label>

              <div style={{ display: "grid", gap: "0.75rem" }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 650 }}>Members ({group.members.length})</span>
                  <button type="button" className="btn btn--sm" onClick={() => addMember(gi)}>Add member</button>
                </div>

                {group.members.map((member, mi) => (
                  <div key={member.id} style={{ display: "grid", gap: "0.6rem", padding: "0.85rem", border: "1px solid var(--a-line, #ddd)", borderRadius: "12px" }}>
                    <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                      <label className="field" style={{ margin: 0 }}><span>Name</span><input value={member.name} onChange={(e) => setMember(gi, mi, { name: e.target.value })} maxLength={120} placeholder="Full name" required /></label>
                      <label className="field" style={{ margin: 0 }}><span>Role / position</span><input value={member.role} onChange={(e) => setMember(gi, mi, { role: e.target.value })} maxLength={120} placeholder="e.g. Staff Writer" required /></label>
                    </div>
                    <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
                      <button type="button" className="btn btn--sm" disabled={mi === 0} onClick={() => setDraft((d) => ({ ...d, groups: d.groups.map((g, i) => (i === gi ? { ...g, members: move(g.members, mi, mi - 1) } : g)) }))}>Up</button>
                      <button type="button" className="btn btn--sm" disabled={mi === group.members.length - 1} onClick={() => setDraft((d) => ({ ...d, groups: d.groups.map((g, i) => (i === gi ? { ...g, members: move(g.members, mi, mi + 1) } : g)) }))}>Down</button>
                      <button type="button" className="btn btn--sm btn--danger" onClick={() => removeMember(gi, mi)}>Remove</button>
                    </div>
                  </div>
                ))}
                {group.members.length === 0 ? <p className="desk-note" style={{ margin: 0 }}>No members in this group yet.</p> : null}
              </div>
            </div>
          ))}

          {draft.groups.length === 0 ? <p className="desk-note">No groups yet. Add a group to start building the team page.</p> : null}
        </section>

        <div className="row" style={{ gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
          <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? "Saving…" : "Save team page"}</button>
          <Link to="/team" className="btn" target="_blank" rel="noreferrer">Preview /team</Link>
          {message ? <span className="banner" role="status" style={{ margin: 0 }}>{message}</span> : null}
          {error ? <span className="banner banner--bad" role="alert" style={{ margin: 0 }}>{error}</span> : null}
        </div>
      </form>
    </>
  );
}
