import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { adminPending } from "@/components/admin/pending";
import { errorText } from "@/components/admin/gate";
import { adminEvents, adminSaveEvents } from "@/content/admin-api";
import {
  EVENT_EFFECTS,
  EVENT_PRESETS,
  MAX_EVENTS,
  eventPreset,
  eventLifecycle,
  purgeDeadline,
  EXPIRED_RETENTION_DAYS,
  newEventDraft,
  celebratedYear,
  endOfDateIST,
  istDateOf,
  startOfDateIST,
  EVENT_YEAR_MAX,
  EVENT_YEAR_MIN,
  type EventEffect,
  type EventLifecycle,
  type EventTheme,
  type EventsConfig,
  type SiteEvent,
} from "@/lib/events";

export const Route = createFileRoute("/admin/events")({
  ...adminPending,
  loader: () => adminEvents(),
  component: EventsAdmin,
});

const EFFECT_LABELS: Record<EventEffect, string> = {
  snow: "Falling snow",
  confetti: "Falling confetti",
  sparkle: "Twinkling sparkles",
  none: "No particles (colours only)",
};

// t210: schedules are whole dates in India time; the browser's own timezone is never used.
const dateInputValue = (iso: string) => istDateOf(iso);
function formatWhen(iso: string, _now: number): string {
  const day = istDateOf(iso);
  if (!day) return "";
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`;
}

const LIFECYCLE_LABEL: Record<EventLifecycle, string> = {
  upcoming: "Upcoming",
  ongoing: "Ongoing",
  waiting: "Scheduled · another event is showing",
  paused: "Paused",
  expired: "Expired",
};

/** t213/t214: one-line date range + status explanation for a saved card. */
function cardDetail(event: SiteEvent, state: EventLifecycle, now: number): string {
  const range =
    event.startsAt || event.endsAt
      ? `${event.startsAt ? formatWhen(event.startsAt, now) : "Any time"} – ${event.endsAt ? formatWhen(event.endsAt, now) : "no end date"}`
      : "No dates: shows until you pause it (festival dates move every year — set this year's dates before switching on)";
  const deadline = purgeDeadline(event);
  if (state === "expired" && deadline !== null) {
    const days = Math.max(1, Math.ceil((deadline - now) / 86_400_000));
    return `${range} · Deletes automatically on ${formatWhen(new Date(deadline).toISOString(), now)} (in ${days} day${days === 1 ? "" : "s"}) unless you edit or reschedule it`;
  }
  if (state === "upcoming") return `${range} · Turns on automatically on the start date`;
  if (state === "ongoing") return `${range} · On the site now${event.endsAt ? ", turns off automatically after the end date" : ""}`;
  if (state === "paused") return `${range} · Paused: not shown until you switch it back on`;
  if (state === "waiting") return `${range} · Inside its dates; the most recently started event is the one shown`;
  return range;
}

function EventsAdmin() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const [saved, setSaved] = useState<EventsConfig>(data.config);
  const [version, setVersion] = useState<string>(data.version);
  // t213: one editor at the top. null = closed; editingId null + draft = a new event.
  const [draft, setDraft] = useState<SiteEvent | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setSaved(data.config);
    setVersion(data.version);
  }, [data.config, data.version]);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const original = useMemo(() => (editingId ? saved.events.find((e) => e.id === editingId) ?? null : null), [editingId, saved]);
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(original);

  const patchDraft = useCallback((next: Partial<SiteEvent>) => {
    setDraft((current) => (current ? { ...current, ...next } : current));
    setMessage(null);
  }, []);

  const applyTheme = (theme: EventTheme) => {
    if (!draft) return;
    const preset = eventPreset(theme);
    const customMessage = draft.message.trim().length > 0 && draft.message !== eventPreset(draft.theme).message;
    patchDraft({ theme, effect: preset.effect, colors: { ...preset.colors }, message: customMessage ? draft.message : preset.message });
  };

  const startNew = () => {
    if (saved.events.length >= MAX_EVENTS) return;
    const base = newEventDraft("christmas");
    let id = base.id;
    for (let n = 2; saved.events.some((event) => event.id === id); n += 1) id = `${base.id}-${n}`;
    // t213: a scheduled event is on unless the owner pauses it.
    setDraft({ ...base, id, enabled: true });
    setEditingId(null);
    setError(null);
    setMessage(null);
  };

  const startEdit = (event: SiteEvent) => {
    setDraft(structuredClone(event));
    setEditingId(event.id);
    setError(null);
    setMessage(null);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancel = () => {
    if (dirty && typeof window !== "undefined" && !window.confirm("Discard your unsaved changes?")) return;
    setDraft(null);
    setEditingId(null);
    setError(null);
  };

  const persist = async (events: SiteEvent[], done: string) => {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const out = await adminSaveEvents({ data: { config: { events }, version } });
      setSaved(out.config);
      setVersion(out.version);
      setDraft(null);
      setEditingId(null);
      setMessage(`${done} New page loads use it right away (pages already open may take up to a minute).`);
      await router.invalidate();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPending(false);
    }
  };

  const saveDraft = () => {
    if (!draft) return;
    const events = editingId ? saved.events.map((e) => (e.id === editingId ? draft : e)) : [...saved.events, draft];
    void persist(events, editingId ? "Event updated." : "Event saved.");
  };

  const removeSaved = (event: SiteEvent) => {
    if (typeof window !== "undefined" && !window.confirm(`Delete “${event.name}”? This cannot be undone.`)) return;
    void persist(
      saved.events.filter((e) => e.id !== event.id),
      "Event deleted.",
    );
  };

  return (
    <>
      <p className="desk-kicker">Site</p>
      <h1 className="desk-title">Events</h1>
      <p className="desk-note">
        Seasonal decorations for the whole public site. Fill in an event and save it: it appears as a card below and turns on and
        off by itself on its dates (India time). Expired events stay for {EXPIRED_RETENTION_DAYS} days, then are deleted
        automatically unless you edit or reschedule them. Article pages, the homepage, ads and your theme colours are never changed.
      </p>

      {draft ? (
        <fieldset className="block-card" style={{ marginTop: "1rem" }}>
          <legend>{editingId ? `Edit: ${original?.name || "event"}` : "New event"}</legend>
          <label className="check-row">
            <input type="checkbox" checked={draft.enabled} onChange={(e) => patchDraft({ enabled: e.target.checked })} />
            Active (untick to pause without deleting)
          </label>
        <div className="filters">
          <label className="field">
            <span>Name</span>
            <input value={draft.name} maxLength={60} onChange={(e) => patchDraft({ name: e.target.value })} />
          </label>
          <label className="field">
            <span>Theme</span>
            <select value={draft.theme} onChange={(e) => applyTheme(e.target.value as EventTheme)}>
              {EVENT_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="filters">
          <label className="field">
            <span>Start date (optional)</span>
            <input
              type="date"
              value={dateInputValue(draft.startsAt)}
              onChange={(e) => {
                // t202: empty = open-ended. t210: whole day, from 00:00 India time.
                if (!e.target.value) patchDraft({ startsAt: "" });
                else {
                  const iso = startOfDateIST(e.target.value);
                  if (iso) patchDraft({ startsAt: iso });
                }
              }}
            />
          </label>
          <label className="field">
            <span>End date (optional, included)</span>
            <input
              type="date"
              value={dateInputValue(draft.endsAt)}
              min={dateInputValue(draft.startsAt) || undefined}
              onChange={(e) => {
                // t210: the end date is included — the event shows until 23:59 India time that day.
                if (!e.target.value) patchDraft({ endsAt: "" });
                else {
                  const iso = endOfDateIST(e.target.value);
                  if (iso) patchDraft({ endsAt: iso });
                }
              }}
            />
          </label>
          <label className="field">
            <span>Year shown in design</span>
            <input
              type="number"
              inputMode="numeric"
              min={EVENT_YEAR_MIN}
              max={EVENT_YEAR_MAX}
              step={1}
              placeholder={`Auto (${celebratedYear({ ...draft, year: null })})`}
              value={draft.year ?? ""}
              onChange={(e) => {
                const raw = e.target.value.trim();
                if (!raw) return patchDraft({ year: null });
                const year = Number(raw);
                if (Number.isInteger(year) && year >= EVENT_YEAR_MIN && year <= EVENT_YEAR_MAX) patchDraft({ year });
              }}
            />
          </label>
        </div>
        <p className="field-help">Dates only, in India time (IST): the event shows from the start of the start date until the end of the end date (both days included). Leave a date empty for no limit on that side: both empty = on until you untick “Use this event”. Year: leave empty for automatic, or set it (e.g. 2028) and designs that show a year — the New Year footer — use exactly that year.</p>

        <label className="check-row">
          <input type="checkbox" checked={draft.banner} onChange={(e) => patchDraft({ banner: e.target.checked })} />
          Show a message bar above the header
        </label>
        {draft.banner ? (
          <div className="stack" style={{ gap: "0.55rem" }}>
            <label className="field">
              <span>Message</span>
              <input
                value={draft.message}
                maxLength={160}
                placeholder="Merry Christmas from …"
                onChange={(e) => patchDraft({ message: e.target.value })}
              />
            </label>
            <div className="filters">
              <label className="field">
                <span>Button label (optional)</span>
                <input value={draft.ctaLabel} maxLength={30} onChange={(e) => patchDraft({ ctaLabel: e.target.value })} />
              </label>
              <label className="field">
                <span>Button link</span>
                <input
                  value={draft.ctaHref}
                  maxLength={300}
                  placeholder="/about or https://…"
                  onChange={(e) => patchDraft({ ctaHref: e.target.value })}
                />
              </label>
            </div>
          </div>
        ) : null}

        <div className="filters" style={{ marginTop: "0.5rem" }}>
          <label className="field">
            <span>Decoration effect</span>
            <select value={draft.effect} onChange={(e) => patchDraft({ effect: e.target.value as EventEffect })}>
              {EVENT_EFFECTS.map((effect) => (
                <option key={effect} value={effect}>
                  {EFFECT_LABELS[effect]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>How much</span>
            <select value={draft.intensity} onChange={(e) => patchDraft({ intensity: e.target.value as SiteEvent["intensity"] })}>
              <option value="subtle">Subtle</option>
              <option value="festive">Festive</option>
            </select>
          </label>
        </div>

        {draft.effect !== "none" ? (
          <div className="filters" style={{ alignItems: "end" }}>
            <label className="field">
              <span>Main colour</span>
              <input
                type="color"
                value={draft.colors.primary}
                onChange={(e) => patchDraft({ colors: { ...draft.colors, primary: e.target.value } })}
              />
            </label>
            <label className="field">
              <span>Accent colour</span>
              <input
                type="color"
                value={draft.colors.secondary}
                onChange={(e) => patchDraft({ colors: { ...draft.colors, secondary: e.target.value } })}
              />
            </label>
            <label className="field">
              <span>Text / stripe colour</span>
              <input
                type="color"
                value={draft.colors.ink}
                onChange={(e) => patchDraft({ colors: { ...draft.colors, ink: e.target.value } })}
              />
            </label>
          </div>
        ) : null}
          <div className="inline-actions adm-savebar" style={{ marginTop: "1rem" }}>
            <button type="button" className="btn" onClick={saveDraft} disabled={pending || !draft.name.trim()}>
              {pending ? "Saving…" : editingId ? "Save changes" : "Save event"}
            </button>
            <button type="button" className="btn btn--ghost" onClick={cancel} disabled={pending}>
              Cancel
            </button>
            {dirty ? <span className="field-help" style={{ margin: 0 }}>Unsaved changes</span> : null}
          </div>
        </fieldset>
      ) : (
        <div className="inline-actions" style={{ marginTop: "1rem" }}>
          <button type="button" className="btn" onClick={startNew} disabled={saved.events.length >= MAX_EVENTS || pending}>
            Add event
          </button>
          <span className="field-help" style={{ margin: 0 }}>
            {saved.events.length} of {MAX_EVENTS} events
          </span>
        </div>
      )}

      {error ? (
        <p className="banner banner--bad" role="alert" style={{ marginTop: "0.75rem" }}>
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="banner banner--ok" role="status" style={{ marginTop: "0.75rem" }}>
          {message}
        </p>
      ) : null}

      <h2 className="desk-title" style={{ fontSize: "1.1rem", marginTop: "1.5rem" }}>Saved events</h2>
      <ul className="stack" style={{ listStyle: "none", padding: 0, marginTop: "0.5rem" }} aria-label="Saved events">
        {saved.events.length === 0 ? <li className="field-help">No saved events yet. Use “Add event” above.</li> : null}
        {saved.events.map((event) => {
          const state = now === null ? null : eventLifecycle(event, saved, now);
          return (
            <li key={event.id} className="block-card" style={{ padding: "0.75rem 1rem" }} data-state={state ?? undefined}>
              <div className="inline-actions" style={{ justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
                <div>
                  <strong>{event.name}</strong>{" "}
                  <span className="field-help" style={{ margin: 0 }}>
                    · {eventPreset(event.theme).label}
                    {event.year ? ` · ${event.year}` : ""}
                  </span>
                  {state ? (
                    <span className={`chip chip--${state}`} style={{ marginLeft: "0.5rem", fontWeight: 600 }}>
                      {LIFECYCLE_LABEL[state]}
                      {state === "expired" && !event.enabled ? " · paused" : ""}
                    </span>
                  ) : null}
                  {state && now !== null ? <p className="field-help" style={{ margin: "0.25rem 0 0" }}>{cardDetail(event, state, now)}</p> : null}
                </div>
                <div className="inline-actions">
                  <button type="button" className="btn btn--ghost" onClick={() => startEdit(event)} disabled={pending}>
                    Edit
                  </button>
                  <a className="btn btn--ghost" href={`/?event=${encodeURIComponent(event.id)}`} target="_blank" rel="noreferrer">
                    Preview
                  </a>
                  <button type="button" className="btn btn--danger-ghost" onClick={() => removeSaved(event)} disabled={pending}>
                    Delete
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
