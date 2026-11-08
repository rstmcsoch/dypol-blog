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
  eventStatus,
  newEventDraft,
  celebratedYear,
  endOfDateIST,
  istDateOf,
  startOfDateIST,
  EVENT_YEAR_MAX,
  EVENT_YEAR_MIN,
  type EventEffect,
  type EventStatus,
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

function statusLine(event: SiteEvent, status: EventStatus, now: number): string {
  if (status === "live") return event.endsAt ? "Live on the site now" : "Live on the site now (no end date)";
  if (status === "upcoming") return `Starts ${formatWhen(event.startsAt, now)}`;
  if (status === "ended") return `Ended ${formatWhen(event.endsAt, now)}`;
  // t209: festival presets ship without dates; say so before the owner switches one on.
  if (!event.startsAt && !event.endsAt) return "Switched off · set this year's dates before switching on (no dates = shows until switched off)";
  return "Switched off";
}

function EventsAdmin() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const [config, setConfig] = useState<EventsConfig>(data.config);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const dirty = useMemo(() => JSON.stringify(config) !== JSON.stringify(data.config), [config, data.config]);

  const patchEvent = useCallback((id: string, next: Partial<SiteEvent>) => {
    setConfig((current) => ({ ...current, events: current.events.map((event) => (event.id === id ? { ...event, ...next } : event)) }));
    setMessage(null);
  }, []);

  const applyTheme = (event: SiteEvent, theme: EventTheme) => {
    const preset = eventPreset(theme);
    const customMessage = event.message.trim().length > 0 && event.message !== eventPreset(event.theme).message;
    patchEvent(event.id, {
      theme,
      effect: preset.effect,
      colors: { ...preset.colors },
      message: customMessage ? event.message : preset.message,
    });
  };

  const addEvent = () => {
    if (config.events.length >= MAX_EVENTS) return;
    const draft = newEventDraft("christmas");
    let id = draft.id;
    for (let n = 2; config.events.some((event) => event.id === id); n += 1) id = `${draft.id}-${n}`;
    setConfig((current) => ({ ...current, events: [...current.events, { ...draft, id }] }));
    setError(null);
    setMessage(null);
  };

  const removeEvent = (id: string) => {
    setConfig((current) => ({ ...current, events: current.events.filter((event) => event.id !== id) }));
    setMessage(null);
  };

  const save = async () => {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const out = await adminSaveEvents({ data: config });
      setConfig(out.config);
      setMessage("Events saved. New page loads use them right away (pages already open in a browser may take up to a minute).");
      await router.invalidate();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <p className="desk-kicker">Site</p>
      <h1 className="desk-title">Events</h1>
      <p className="desk-note">
        Seasonal decorations for the whole public site. While an event is inside its dates, visitors see its message bar above
        the header, a festive rule on the header and footer, and a light particle effect. Article pages, the homepage, the
        ticker, ads and your theme colours are never changed — and while no event is live the site looks exactly as it does today.
        New events start switched off: tick “Use this event” and save to put one on the site. Preview works while you are signed in.
      </p>

      <div className="inline-actions" style={{ marginTop: "1rem" }}>
        <button type="button" className="btn btn--ghost" onClick={addEvent} disabled={config.events.length >= MAX_EVENTS}>
          Add event
        </button>
        <span className="field-help" style={{ margin: 0 }}>
          {config.events.length} of {MAX_EVENTS} events · visitors who prefer reduced motion get the colours and message without the
          falling particles.
        </span>
      </div>

      <div className="stack" style={{ marginTop: "1rem" }}>
        {config.events.length === 0 ? (
          <fieldset className="block-card">
            <legend>No events yet</legend>
            <p className="field-help">Add an event (the Christmas preset is pre-filled) to show a message and decorations for a set period.</p>
          </fieldset>
        ) : null}

        {config.events.map((event) => {
          const status = now === null ? null : eventStatus(event, now);
          return (
            <fieldset className="block-card" key={event.id}>
              <legend>{event.name.trim() || "Untitled event"}</legend>

              <div className="inline-actions" style={{ justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
                <label className="check-row" style={{ margin: 0 }}>
                  <input type="checkbox" checked={event.enabled} onChange={(e) => patchEvent(event.id, { enabled: e.target.checked })} />
                  Use this event
                </label>
                <span className="field-help" style={{ margin: 0, fontWeight: 600 }}>
                  {status && now !== null ? statusLine(event, status, now) : ""}
                </span>
                <div className="inline-actions" style={{ marginLeft: "auto" }}>
                  <a className="btn btn--ghost" href={`/?event=${encodeURIComponent(event.id)}`} target="_blank" rel="noreferrer">
                    Preview
                  </a>
                  <button type="button" className="btn btn--danger-ghost" onClick={() => removeEvent(event.id)}>
                    Delete
                  </button>
                </div>
              </div>

              <div className="filters">
                <label className="field">
                  <span>Name</span>
                  <input value={event.name} maxLength={60} onChange={(e) => patchEvent(event.id, { name: e.target.value })} />
                </label>
                <label className="field">
                  <span>Theme</span>
                  <select value={event.theme} onChange={(e) => applyTheme(event, e.target.value as EventTheme)}>
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
                    value={dateInputValue(event.startsAt)}
                    onChange={(e) => {
                      // t202: empty = open-ended. t210: whole day, from 00:00 India time.
                      if (!e.target.value) patchEvent(event.id, { startsAt: "" });
                      else {
                        const iso = startOfDateIST(e.target.value);
                        if (iso) patchEvent(event.id, { startsAt: iso });
                      }
                    }}
                  />
                </label>
                <label className="field">
                  <span>End date (optional, included)</span>
                  <input
                    type="date"
                    value={dateInputValue(event.endsAt)}
                    min={dateInputValue(event.startsAt) || undefined}
                    onChange={(e) => {
                      // t210: the end date is included — the event shows until 23:59 India time that day.
                      if (!e.target.value) patchEvent(event.id, { endsAt: "" });
                      else {
                        const iso = endOfDateIST(e.target.value);
                        if (iso) patchEvent(event.id, { endsAt: iso });
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
                    placeholder={`Auto (${celebratedYear({ ...event, year: null })})`}
                    value={event.year ?? ""}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      if (!raw) return patchEvent(event.id, { year: null });
                      const year = Number(raw);
                      if (Number.isInteger(year) && year >= EVENT_YEAR_MIN && year <= EVENT_YEAR_MAX) patchEvent(event.id, { year });
                    }}
                  />
                </label>
              </div>
              <p className="field-help">Dates only, in India time (IST): the event shows from the start of the start date until the end of the end date (both days included). Leave a date empty for no limit on that side: both empty = on until you untick “Use this event”. Year: leave empty for automatic, or set it (e.g. 2028) and designs that show a year — the New Year footer — use exactly that year.</p>

              <label className="check-row">
                <input type="checkbox" checked={event.banner} onChange={(e) => patchEvent(event.id, { banner: e.target.checked })} />
                Show a message bar above the header
              </label>
              {event.banner ? (
                <div className="stack" style={{ gap: "0.55rem" }}>
                  <label className="field">
                    <span>Message</span>
                    <input
                      value={event.message}
                      maxLength={160}
                      placeholder="Merry Christmas from …"
                      onChange={(e) => patchEvent(event.id, { message: e.target.value })}
                    />
                  </label>
                  <div className="filters">
                    <label className="field">
                      <span>Button label (optional)</span>
                      <input value={event.ctaLabel} maxLength={30} onChange={(e) => patchEvent(event.id, { ctaLabel: e.target.value })} />
                    </label>
                    <label className="field">
                      <span>Button link</span>
                      <input
                        value={event.ctaHref}
                        maxLength={300}
                        placeholder="/about or https://…"
                        onChange={(e) => patchEvent(event.id, { ctaHref: e.target.value })}
                      />
                    </label>
                  </div>
                </div>
              ) : null}

              <div className="filters" style={{ marginTop: "0.5rem" }}>
                <label className="field">
                  <span>Decoration effect</span>
                  <select value={event.effect} onChange={(e) => patchEvent(event.id, { effect: e.target.value as EventEffect })}>
                    {EVENT_EFFECTS.map((effect) => (
                      <option key={effect} value={effect}>
                        {EFFECT_LABELS[effect]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>How much</span>
                  <select value={event.intensity} onChange={(e) => patchEvent(event.id, { intensity: e.target.value as SiteEvent["intensity"] })}>
                    <option value="subtle">Subtle</option>
                    <option value="festive">Festive</option>
                  </select>
                </label>
              </div>

              {event.effect !== "none" ? (
                <div className="filters" style={{ alignItems: "end" }}>
                  <label className="field">
                    <span>Main colour</span>
                    <input
                      type="color"
                      value={event.colors.primary}
                      onChange={(e) => patchEvent(event.id, { colors: { ...event.colors, primary: e.target.value } })}
                    />
                  </label>
                  <label className="field">
                    <span>Accent colour</span>
                    <input
                      type="color"
                      value={event.colors.secondary}
                      onChange={(e) => patchEvent(event.id, { colors: { ...event.colors, secondary: e.target.value } })}
                    />
                  </label>
                  <label className="field">
                    <span>Text / stripe colour</span>
                    <input
                      type="color"
                      value={event.colors.ink}
                      onChange={(e) => patchEvent(event.id, { colors: { ...event.colors, ink: e.target.value } })}
                    />
                  </label>
                </div>
              ) : null}
            </fieldset>
          );
        })}
      </div>

      <div className="inline-actions adm-savebar" style={{ marginTop: "1rem" }}>
        <button type="button" className="btn" onClick={() => void save()} disabled={pending}>
          {pending ? "Saving…" : "Save events"}
        </button>
        {dirty ? (
          <span className="field-help" style={{ margin: 0 }}>
            Unsaved changes
          </span>
        ) : null}
        {error ? (
          <p className="banner banner--bad" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="banner banner--ok" role="status" style={{ margin: 0 }}>
            {message}
          </p>
        ) : null}
      </div>
    </>
  );
}
