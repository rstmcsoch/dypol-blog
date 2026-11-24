import { useState } from "react";
import { adminPending } from "@/components/admin/pending";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { errorText } from "@/components/admin/gate";
import { adminSaveTeam, adminTeam } from "@/content/team-admin-api";
import {
  createTeamId,
  DEFAULT_TEAM_SETTINGS,
  teamMemberCount,
  type TeamGroup,
  type TeamMember,
  type TeamSettings,
} from "@/lib/team";

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
  const [savedSnapshot, setSavedSnapshot] = useState<string>(() => JSON.stringify(loaded));
  const [draft, setDraft] = useState<TeamSettings>(() => clone(loaded));
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const dirty = JSON.stringify(draft) !== savedSnapshot;
  const query = search.trim().toLowerCase();

  const save = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await adminSaveTeam({ data: draft });
      setDraft(clone(saved));
      setSavedSnapshot(JSON.stringify(saved));
      setMessage("Team page saved and live.");
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

  const addGroup = () => {
    const id = createTeamId("g");
    setDraft((d) => ({
      ...d,
      groups: [
        ...d.groups,
        { id, kicker: "New group", title: "Group title", note: "", members: [] },
      ],
    }));
  };

  const removeGroup = (gi: number) => {
    if (!window.confirm("Remove this group and all its members?")) return;
    setDraft((d) => ({ ...d, groups: d.groups.filter((_, i) => i !== gi) }));
  };

  const addMember = (gi: number) =>
    setDraft((d) => ({
      ...d,
      groups: d.groups.map((g, i) =>
        i === gi ? { ...g, members: [...g.members, { id: createTeamId("m"), name: "", role: "", bio: "" }] } : g,
      ),
    }));

  const duplicateMember = (gi: number, mi: number) =>
    setDraft((d) => ({
      ...d,
      groups: d.groups.map((g, i) => {
        if (i !== gi) return g;
        const src = g.members[mi];
        if (!src) return g;
        const copy: TeamMember = { ...src, id: createTeamId("m"), name: `${src.name} (copy)` };
        const next = g.members.slice();
        next.splice(mi + 1, 0, copy);
        return { ...g, members: next };
      }),
    }));

  const moveMemberToGroup = (fromGi: number, mi: number, toGi: number) => {
    if (fromGi === toGi) return;
    setDraft((d) => {
      const member = d.groups[fromGi]?.members[mi];
      if (!member) return d;
      return {
        ...d,
        groups: d.groups.map((g, i) => {
          if (i === fromGi) return { ...g, members: g.members.filter((_, j) => j !== mi) };
          if (i === toGi) return { ...g, members: [...g.members, member] };
          return g;
        }),
      };
    });
  };

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
        Manage the public <Link to="/team">/team</Link> page. Add, edit, hide/show, reorder, transfer between groups, or delete any group or member.
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
            <p className="desk-note" style={{ marginBottom: 0 }}>
              {teamMemberCount(draft, true)} visible ({teamMemberCount(draft)} total) across {draft.groups.length} group{draft.groups.length === 1 ? "" : "s"}.
              {dirty ? " · Unsaved changes" : ""}
            </p>
          </div>
        </section>

        <section className="desk-section">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>Groups & members</h2>
            <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter members by name or role…"
                style={{ minWidth: "200px" }}
              />
              <button type="button" className="btn" onClick={addGroup}>+ Add group</button>
            </div>
          </div>

          {draft.groups.map((group, gi) => {
            const isCollapsed = Boolean(collapsed[group.id]) && !query;
            const matchingMembers = group.members
              .map((member, mi) => ({ member, mi }))
              .filter(({ member }) => !query || member.name.toLowerCase().includes(query) || member.role.toLowerCase().includes(query));

            return (
              <div key={group.id} className="block-card" style={{ display: "grid", gap: "1rem", opacity: group.visible === false ? 0.65 : 1 }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                  <div className="row" style={{ gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost"
                      onClick={() => setCollapsed((c) => ({ ...c, [group.id]: !c[group.id] }))}
                    >
                      {isCollapsed ? "Expand" : "Collapse"}
                    </button>
                    <strong>{group.kicker || `Group ${gi + 1}`}</strong>
                    <span className="muted">({group.members.length})</span>
                    {group.visible === false ? <span className="badge badge--bad">hidden</span> : null}
                  </div>
                  <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost"
                      onClick={() => setGroup(gi, { visible: group.visible === false ? undefined : false })}
                    >
                      {group.visible === false ? "Show group" : "Hide group"}
                    </button>
                    <button type="button" className="btn btn--sm" disabled={gi === 0} onClick={() => setDraft((d) => ({ ...d, groups: move(d.groups, gi, gi - 1) }))}>Move up</button>
                    <button type="button" className="btn btn--sm" disabled={gi === draft.groups.length - 1} onClick={() => setDraft((d) => ({ ...d, groups: move(d.groups, gi, gi + 1) }))}>Move down</button>
                    <button type="button" className="btn btn--sm btn--danger" onClick={() => removeGroup(gi)}>Remove group</button>
                  </div>
                </div>

                {!isCollapsed ? (
                  <>
                    <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                      <label className="field"><span>Group kicker</span><input value={group.kicker} onChange={(e) => setGroup(gi, { kicker: e.target.value })} maxLength={120} required /></label>
                      <label className="field"><span>Group title</span><input value={group.title} onChange={(e) => setGroup(gi, { title: e.target.value })} maxLength={200} required /></label>
                    </div>
                    <label className="field"><span>Group note (optional)</span><input value={group.note} onChange={(e) => setGroup(gi, { note: e.target.value })} maxLength={300} /></label>

                    <div style={{ display: "grid", gap: "0.75rem" }}>
                      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 650 }}>Members ({matchingMembers.length}{query ? ` of ${group.members.length}` : ""})</span>
                        <button type="button" className="btn btn--sm" onClick={() => addMember(gi)}>+ Add member</button>
                      </div>

                      {matchingMembers.map(({ member, mi }) => (
                        <div
                          key={member.id}
                          style={{
                            display: "grid",
                            gap: "0.6rem",
                            padding: "0.85rem",
                            border: "1px solid var(--a-line, #ddd)",
                            borderRadius: "12px",
                            opacity: member.visible === false ? 0.6 : 1,
                          }}
                        >
                          <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                            <label className="field" style={{ margin: 0 }}><span>Name</span><input value={member.name} onChange={(e) => setMember(gi, mi, { name: e.target.value })} maxLength={120} placeholder="Full name" required /></label>
                            <label className="field" style={{ margin: 0 }}><span>Role / position</span><input value={member.role} onChange={(e) => setMember(gi, mi, { role: e.target.value })} maxLength={120} placeholder="e.g. Staff Writer" required /></label>
                          </div>
                          <label className="field" style={{ margin: 0 }}>
                            <span>Short bio / beat (optional)</span>
                            <input value={member.bio ?? ""} onChange={(e) => setMember(gi, mi, { bio: e.target.value || undefined })} maxLength={240} placeholder="Optional 1-line beat or bio" />
                          </label>
                          <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
                            <button type="button" className="btn btn--sm" disabled={mi === 0} onClick={() => setDraft((d) => ({ ...d, groups: d.groups.map((g, i) => (i === gi ? { ...g, members: move(g.members, mi, mi - 1) } : g)) }))}>Up</button>
                            <button type="button" className="btn btn--sm" disabled={mi === group.members.length - 1} onClick={() => setDraft((d) => ({ ...d, groups: d.groups.map((g, i) => (i === gi ? { ...g, members: move(g.members, mi, mi + 1) } : g)) }))}>Down</button>
                            {draft.groups.length > 1 ? (
                              <select
                                aria-label="Move member to another group"
                                value={String(gi)}
                                onChange={(e) => moveMemberToGroup(gi, mi, Number(e.target.value))}
                                style={{ fontSize: "0.82rem", padding: "0.25rem 0.5rem" }}
                              >
                                {draft.groups.map((targetG, targetIdx) => (
                                  <option key={targetG.id} value={String(targetIdx)}>
                                    {targetIdx === gi ? `Group: ${targetG.kicker}` : `Move to: ${targetG.kicker}`}
                                  </option>
                                ))}
                              </select>
                            ) : null}
                            <button
                              type="button"
                              className="btn btn--sm btn--ghost"
                              onClick={() => setMember(gi, mi, { visible: member.visible === false ? undefined : false })}
                            >
                              {member.visible === false ? "Show" : "Hide"}
                            </button>
                            <button type="button" className="btn btn--sm btn--ghost" onClick={() => duplicateMember(gi, mi)}>Duplicate</button>
                            <button type="button" className="btn btn--sm btn--danger" onClick={() => removeMember(gi, mi)}>Remove</button>
                          </div>
                        </div>
                      ))}
                      {group.members.length === 0 ? <p className="desk-note" style={{ margin: 0 }}>No members in this group yet.</p> : null}
                    </div>
                  </>
                ) : null}
              </div>
            );
          })}

          {draft.groups.length === 0 ? <p className="desk-note">No groups yet. Add a group above or reset to defaults below.</p> : null}
        </section>

        <div className="row" style={{ gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
          <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? "Saving…" : "Save team page"}</button>
          <Link to="/team" className="btn" target="_blank" rel="noreferrer">Preview /team</Link>
          {dirty ? (
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setDraft(JSON.parse(savedSnapshot) as TeamSettings)}>
              Discard unsaved changes
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy}
            onClick={() => {
              if (!window.confirm("Reset the team page draft back to the default editorial roster? Click Save afterwards to apply.")) return;
              setDraft(clone(DEFAULT_TEAM_SETTINGS));
            }}
          >
            Reset to defaults
          </button>
          {message ? <span className="banner" role="status" style={{ margin: 0 }}>{message}</span> : null}
          {error ? <span className="banner banner--bad" role="alert" style={{ margin: 0 }}>{error}</span> : null}
        </div>
      </form>
    </>
  );
}
