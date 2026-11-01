/**
 * t148: Ads admin. Slots, sponsors, global scripts + ads.txt, density rules
 * (editable defaults, soft warnings only), consent banner, stats, history and
 * a code test sandbox. Saves go live immediately (content_version cache).
 */
import { useMemo, useRef, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { adminPending } from "@/components/admin/pending";
import { adminAds, adminAdStats, adminAdVersions, adminRestoreAdVersion, adminSaveAds, adminUploadBanner } from "@/content/ads-api";
import {
  AD_SIZES,
  codeDims,
  DEVICES,
  PAGE_TYPE_LABELS,
  PAGE_TYPES,
  SLOT_CATALOG,
  densityWarnings,
  newCreative,
  normalizeAdsSettings,
  slotDef,
  slotStatus,
  type AdSize,
  type AdsSettings,
  type Creative,
  type Device,
  type GlobalScript,
  type Schedule,
  type SlotBody,
  type SlotConfig,
  type SlotStatus,
  type Sponsor,
} from "@/lib/ads/model";

export const Route = createFileRoute("/admin/ads")({
  ...adminPending,
  loader: () => adminAds(),
  component: AdsAdmin,
});

const TABS = ["Slots", "Sponsors", "Scripts & ads.txt", "Settings", "Stats", "History", "Test code"] as const;
type Tab = (typeof TABS)[number];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;

// ---- IST helpers (schedules are stored in UTC, edited in IST) ----
const IST_MS = 330 * 60_000;
function isoToIstInput(iso: string | null): string {
  if (!iso) return "";
  return new Date(Date.parse(iso) + IST_MS).toISOString().slice(0, 16);
}
function istInputToIso(v: string): string | null {
  if (!v) return null;
  const t = Date.parse(`${v}:00Z`);
  return Number.isFinite(t) ? new Date(t - IST_MS).toISOString() : null;
}
function fmtIst(iso: string | null): string {
  if (!iso) return "—";
  return `${new Date(Date.parse(iso) + IST_MS).toISOString().slice(0, 16).replace("T", " ")} IST`;
}


function AdsAdmin() {
  const data = Route.useLoaderData();
  const [saved, setSaved] = useState<AdsSettings>(() => normalizeAdsSettings(data.settings));
  const [s, setS] = useState<AdsSettings>(saved);
  const [tab, setTab] = useState<Tab>("Slots");
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const now = Date.now();
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);
  const warnings = useMemo(() => densityWarnings(s, now), [s, now]);

  async function save(next: AdsSettings = s, reason = "save") {
    setBusy(true);
    setMsg(null);
    try {
      const out = await adminSaveAds({ data: { settings: next, reason } });
      const n = normalizeAdsSettings(out.settings);
      setSaved(n);
      setS(n);
      setMsg({ ok: true, text: "Saved. Changes are live on the site now." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not save." });
    } finally {
      setBusy(false);
    }
  }
  const setSlot = (id: string, patch: Partial<SlotConfig>) => setS((x) => ({ ...x, slots: x.slots.map((sl) => (sl.id === id ? { ...sl, ...patch } : sl)) }));

  return (
    <div className="stack adm-ads" data-testid="ads-admin">
      <div>
        <p className="desk-kicker">Site</p>
        <h1 className="desk-title">Ads</h1>
        <p className="desk-note">
          Ad placements across the public site. A slot shows only when it is on, has code (or a sponsor banner), is inside its schedule and matches the page. An empty slot leaves the
          page exactly as it is today. How many ads to run is your call: the rules under Settings are editable defaults and only produce warnings.
        </p>
      </div>
      <div className="ads-head">
        <label className="ads-switch ads-switch--lg">
          <input type="checkbox" role="switch" checked={s.master} onChange={(e) => setS({ ...s, master: e.target.checked })} data-testid="ads-master" />
          <span className="ads-switch__track" aria-hidden="true" />
          <span className="ads-head__text">
            <strong>Ads master switch</strong>
            <small>{s.master ? "On: slots that are on and have code can show." : "Off: no ads anywhere on the site."}</small>
          </span>
        </label>
        <div className="ads-head__actions">
          <a className="btn btn--ghost" href="/?adpreview=1" target="_blank" rel="noopener">
            Preview placements
          </a>
          <a className="btn btn--ghost" href="/articles?adpreview=1" target="_blank" rel="noopener">
            Preview on /articles
          </a>
        </div>
      </div>
      <div className="ads-tabs" role="tablist" aria-label="Ads sections">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`adm-chip${tab === t ? " adm-chip--active" : ""}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {warnings.length ? (
        <div className="banner" role="note">
          <strong>Heads-up (nothing is blocked):</strong>
          <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem" }}>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "Slots" ? (
        editing ? (
          <SlotEditor
            key={editing}
            slot={s.slots.find((x) => x.id === editing)!}
            savedSlot={saved.slots.find((x) => x.id === editing)!}
            settings={s}
            onRestored={(n) => { setSaved(n); setS(n); setMsg({ ok: true, text: "Version restored and live." }); }}
            onBack={() => setEditing(null)}
            onChange={(patch) => setSlot(editing, patch)}
            onSave={(next, reason) => void save(next, reason)}
            busy={busy}
          />
        ) : (
          <SlotList s={s} now={now} onEdit={setEditing} setSlot={setSlot} />
        )
      ) : null}
      {tab === "Sponsors" ? <SponsorsTab s={s} setS={setS} /> : null}
      {tab === "Scripts & ads.txt" ? <ScriptsTab s={s} setS={setS} /> : null}
      {tab === "Settings" ? <SettingsTab s={s} setS={setS} /> : null}
      {tab === "Stats" ? <StatsTab s={s} /> : null}
      {tab === "History" ? <HistoryTab audit={data.audit} onRestored={(n) => { setSaved(n); setS(n); }} /> : null}
      {tab === "Test code" ? <SandboxTab /> : null}

      <div className="inline-actions adm-savebar ads-savebar">
        <button className="btn" type="button" disabled={busy || !dirty} onClick={() => void save()} data-testid="ads-save">
          {busy ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </button>
        {dirty ? (
          <button className="btn btn--ghost" type="button" disabled={busy} onClick={() => setS(saved)}>
            Discard
          </button>
        ) : null}
        {msg ? (
          <p className={`banner ${msg.ok ? "banner--ok" : "banner--bad"}`} role={msg.ok ? "status" : "alert"} style={{ margin: 0 }}>
            {msg.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ---------------- Slots ----------------
const STATUS_TONE: Record<SlotStatus, string> = { Live: "live", Off: "off", Hidden: "hidden", Scheduled: "scheduled", Expired: "expired", "No code": "nocode" };

function sizeChips(def: NonNullable<ReturnType<typeof slotDef>>): string[] {
  return [...new Set([...def.sizes.desktop, ...def.sizes.tablet, ...def.sizes.mobile])];
}

function SlotList({ s, now, onEdit, setSlot }: { s: AdsSettings; now: number; onEdit: (id: string) => void; setSlot: (id: string, p: Partial<SlotConfig>) => void }) {
  return (
    <div className="ads-slots" data-testid="ads-slot-list">
      {s.slots.map((sl) => {
        const def = slotDef(sl.id)!;
        const status = slotStatus(sl, s, now);
        return (
          <article key={sl.id} className="ads-slot" data-slot-row={sl.id}>
            <div className="ads-slot__main">
              <div className="ads-slot__title">
                <span className="ads-slot__id">{sl.id}</span>
                <strong>{def.name}</strong>
                {def.optional ? <span className="ads-tag">Optional</span> : null}
                {sl.draft ? <span className="ads-tag">Draft saved</span> : null}
              </div>
              <p className="ads-slot__where">{def.where}</p>
              <div className="ads-slot__chips">
                {def.devices.map((d) => (
                  <span key={d} className="ads-chip ads-chip--device">
                    {d === "mobile" ? "Phone" : d === "tablet" ? "Tablet" : "Desktop"}
                  </span>
                ))}
                {sizeChips(def).map((z) => (
                  <span key={z} className="ads-chip">
                    {z}
                  </span>
                ))}
              </div>
            </div>
            <div className="ads-slot__status">
              <span className={`ads-pill ads-pill--${STATUS_TONE[status]}`}>{status}</span>
              {sl.creatives.length ? (
                <small className="adm-muted">
                  {sl.creatives.length} creative{sl.creatives.length > 1 ? "s" : ""}
                </small>
              ) : null}
            </div>
            <div className="ads-slot__actions">
              <label className="ads-switch">
                <input type="checkbox" role="switch" aria-label={`${sl.id} on`} checked={sl.enabled} onChange={(e) => setSlot(sl.id, { enabled: e.target.checked })} />
                <span className="ads-switch__track" aria-hidden="true" />
                <span className="ads-switch__text">{sl.enabled ? "On" : "Off"}</span>
              </label>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => onEdit(sl.id)}>
                Edit
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSlot(sl.id, { hidden: !sl.hidden })}>
                {sl.hidden ? "Unhide" : "Hide"}
              </button>
            </div>
          </article>
        );
      })}
      <p className="ads-note">
        <strong>G3 on About:</strong> the above-footer banner (G3) is off on the About page by default. Tick “About” in G3 → Where it shows to use it there. Legal pages, contact, 404,
        empty searches and the admin never show ads.
      </p>
    </div>
  );
}

function Field({ label, children, help, style }: { label: string; children: ReactNode; help?: ReactNode; style?: React.CSSProperties }) {
  return (
    <label className="field" style={style}>
      <span>{label}</span>
      {children}
      {help ? <small className="field-help">{help}</small> : null}
    </label>
  );
}

function bodyOf(sl: SlotConfig): SlotBody {
  const { enabled, hidden, label, creatives, rotation, frequencyCap, targeting, schedule, notes, houseFallback } = sl;
  return { enabled, hidden, label, creatives, rotation, frequencyCap, targeting, schedule, notes, houseFallback };
}

function SlotEditor({
  slot,
  savedSlot,
  onRestored,
  settings,
  onBack,
  onChange,
  onSave,
  busy,
}: {
  slot: SlotConfig;
  savedSlot: SlotConfig;
  onRestored: (n: AdsSettings) => void;
  settings: AdsSettings;
  onBack: () => void;
  onChange: (patch: Partial<SlotConfig>) => void;
  onSave: (next: AdsSettings, reason: string) => void;
  busy: boolean;
}) {
  const def = slotDef(slot.id)!;
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [versions, setVersions] = useState<Awaited<ReturnType<typeof adminAdVersions>> | null>(null);
  const withSlot = (patch: Partial<SlotConfig>) => ({ ...settings, slots: settings.slots.map((x) => (x.id === slot.id ? { ...x, ...patch } : x)) });
  const setC = (id: string, patch: Partial<Creative>) => onChange({ creatives: slot.creatives.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const sched = slot.schedule;
  const setSched = (p: Partial<Schedule>) => onChange({ schedule: { ...sched, ...p } });
  const t = slot.targeting;

  return (
    <div className="stack" data-testid="slot-editor">
      <p>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onBack}>
          ← All slots
        </button>
      </p>
      <h2 style={{ margin: 0 }}>
        {slot.id} · {def.name}
      </h2>
      <p className="field-help">
        {def.where}. Recommended: desktop {def.sizes.desktop.join(" / ") || "—"}, tablet {def.sizes.tablet.join(" / ") || "—"}, phone {def.sizes.mobile.join(" / ") || "—"}.
        {slot.updatedAt ? ` Last saved ${fmtIst(slot.updatedAt)} by ${slot.updatedBy ?? "editor"}.` : ""}
      </p>
      {slot.draft ? (
        <div className="banner" role="note">
          A draft is saved for this slot (not live).{" "}
          <button type="button" className="btn btn--sm" onClick={() => onChange({ ...slot.draft!, draft: null })}>
            Load draft into the editor
          </button>{" "}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange({ draft: null })}>
            Discard draft
          </button>
        </div>
      ) : null}

      <fieldset className="block-card">
        <legend>Basics</legend>
        <div className="filters">
          <label className="check-row">
            <input type="checkbox" checked={slot.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} /> Slot on
          </label>
          <label className="check-row">
            <input type="checkbox" checked={slot.hidden} onChange={(e) => onChange({ hidden: e.target.checked })} /> Hidden (keep code, show nothing)
          </label>
          <Field label="Label above the ad">
            <select value={slot.label} onChange={(e) => onChange({ label: e.target.value as SlotBody["label"] })}>
              <option value="Advertisement">AD</option>
              <option>Sponsored</option>
            </select>
          </Field>
          <Field label="Rotation">
            <select value={slot.rotation} onChange={(e) => onChange({ rotation: e.target.value as SlotBody["rotation"] })}>
              <option value="weighted">Weighted rotation</option>
              <option value="sponsor-first">Sponsor first, network as fallback</option>
            </select>
          </Field>
          <Field label="Frequency cap (views per visitor per day, 0 = none)">
            <input type="number" min={0} max={100} value={slot.frequencyCap} onChange={(e) => onChange({ frequencyCap: Number(e.target.value) })} />
          </Field>
          <label className="check-row">
            <input type="checkbox" checked={slot.houseFallback} onChange={(e) => onChange({ houseFallback: e.target.checked })} /> Show the house ad when nothing fills
          </label>
        </div>
      </fieldset>

      <fieldset className="block-card">
        <legend>Creatives (ad code, sponsor banners, native cards)</legend>
        {slot.creatives.length === 0 ? <p className="field-help">No creatives yet: this slot shows nothing.</p> : null}
        {slot.creatives.map((c) => (
          <CreativeEditor key={c.id} c={c} sponsors={settings.sponsors} onChange={(p) => setC(c.id, p)} onRemove={() => setConfirmDelete(c.id)} onDuplicate={() => onChange({ creatives: [...slot.creatives, { ...structuredClone(c), id: uid(slot.id.toLowerCase()), name: `${c.name} (copy)` }] })} />
        ))}
        {confirmDelete ? (
          <div className="banner banner--bad" role="alertdialog">
            Delete this creative? You can restore it later from the slot history after saving.{" "}
            <button type="button" className="btn btn--danger btn--sm" onClick={() => { onChange({ creatives: slot.creatives.filter((c) => c.id !== confirmDelete) }); setConfirmDelete(null); }}>
              Delete
            </button>{" "}
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirmDelete(null)}>
              Cancel
            </button>
          </div>
        ) : null}
        <div className="adm-row-actions">
          <button type="button" className="btn btn--ghost" onClick={() => onChange({ creatives: [...slot.creatives, newCreative(def, uid(slot.id.toLowerCase()), "code")] })}>
            Add ad code
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => onChange({ creatives: [...slot.creatives, newCreative(def, uid(slot.id.toLowerCase()), "sponsor")] })}>
            Add sponsor banner
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => onChange({ creatives: [...slot.creatives, newCreative(def, uid(slot.id.toLowerCase()), "native")] })}>
            Add native card
          </button>
        </div>
      </fieldset>

      <fieldset className="block-card">
        <legend>Where it shows</legend>
        <div className="filters">
          <div className="stack" style={{ gap: "0.25rem" }}>
            <span className="field-help">Pages</span>
            {PAGE_TYPES.filter((p) => def.pages.includes(p)).map((p) => (
              <label key={p} className="check-row">
                <input type="checkbox" checked={t.pages.includes(p)} onChange={(e) => onChange({ targeting: { ...t, pages: e.target.checked ? [...t.pages, p] : t.pages.filter((x) => x !== p) } })} />
                {PAGE_TYPE_LABELS[p]}
              </label>
            ))}
          </div>
          <div className="stack" style={{ gap: "0.25rem" }}>
            <span className="field-help">Devices</span>
            {DEVICES.filter((d) => def.devices.includes(d)).map((d) => (
              <label key={d} className="check-row">
                <input type="checkbox" checked={t.devices.includes(d)} onChange={(e) => onChange({ targeting: { ...t, devices: e.target.checked ? [...t.devices, d] : t.devices.filter((x) => x !== d) } })} />
                {d === "mobile" ? "Phone (<768 px)" : d === "tablet" ? "Tablet (768–1023 px)" : "Desktop (≥1024 px)"}
              </label>
            ))}
          </div>
        </div>
        <div className="filters">
          <Field label="Only these article/topic slugs (comma separated)">
            <input value={t.includeSlugs.join(", ")} onChange={(e) => onChange({ targeting: { ...t, includeSlugs: splitList(e.target.value) } })} />
          </Field>
          <Field label="Never on these slugs">
            <input value={t.excludeSlugs.join(", ")} onChange={(e) => onChange({ targeting: { ...t, excludeSlugs: splitList(e.target.value) } })} />
          </Field>
        </div>
        <div className="filters">
          <Field label="Only in these topics (topic slugs)">
            <input value={t.includeTopics.join(", ")} onChange={(e) => onChange({ targeting: { ...t, includeTopics: splitList(e.target.value) } })} />
          </Field>
          <Field label="Never in these topics">
            <input value={t.excludeTopics.join(", ")} onChange={(e) => onChange({ targeting: { ...t, excludeTopics: splitList(e.target.value) } })} />
          </Field>
        </div>
      </fieldset>

      <ScheduleEditor sched={sched} setSched={setSched} />

      <Field label="Notes (admin only)">
        <textarea rows={2} value={slot.notes} onChange={(e) => onChange({ notes: e.target.value })} />
      </Field>

      <div className="adm-row-actions">
        <button type="button" className="btn" disabled={busy} onClick={() => onSave(withSlot({ draft: null }), `slot ${slot.id}`)}>
          Save &amp; publish
        </button>
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => onSave({ ...settings, slots: settings.slots.map((x) => (x.id === slot.id ? { ...savedSlot, draft: bodyOf(slot) } : x)) }, `draft ${slot.id}`)}>
          Save as draft
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          disabled={busy}
          onClick={async () => setVersions(await adminAdVersions({ data: { slotId: slot.id } }))}
        >
          Version history
        </button>
      </div>
      {versions ? (
        <div className="block-card">
          <p className="adm-group__label">Last {versions.length} saved versions of {slot.id}</p>
          {versions.length === 0 ? <p className="field-help">No earlier versions yet.</p> : null}
          {versions.map((v) => (
            <div key={v.id} className="filters" style={{ alignItems: "center" }}>
              <span>
                {fmtIst(v.createdAt)} · {v.actor ?? "editor"} · {v.slot.creatives.length} creative(s), {v.slot.enabled ? "on" : "off"}
              </span>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={async () => {
                  if (!window.confirm(`Restore this version of ${slot.id}? It goes live now.`)) return;
                  const out = await adminRestoreAdVersion({ data: { versionId: v.id } });
                  onRestored(normalizeAdsSettings(out.settings));
                }}
              >
                Restore
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function splitList(v: string): string[] {
  return v.split(/[\n,]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
}

function ScheduleEditor({ sched, setSched }: { sched: Schedule; setSched: (p: Partial<Schedule>) => void }) {
  return (
    <fieldset className="block-card">
      <legend>Schedule (India time, IST)</legend>
      <div className="filters">
        <Field label="Start (IST)" help={sched.start ? `Stored as ${sched.start} UTC` : "Empty = start now"}>
          <input type="datetime-local" value={isoToIstInput(sched.start)} onChange={(e) => setSched({ start: istInputToIso(e.target.value) })} />
        </Field>
        <Field label="End (IST)" help={sched.end ? `Stored as ${sched.end} UTC` : "Empty = no end"}>
          <input type="datetime-local" value={isoToIstInput(sched.end)} onChange={(e) => setSched({ end: istInputToIso(e.target.value) })} />
        </Field>
        <Field label="Daily from (IST)">
          <input type="time" value={sched.from} onChange={(e) => setSched({ from: e.target.value })} />
        </Field>
        <Field label="Daily to (IST)">
          <input type="time" value={sched.to} onChange={(e) => setSched({ to: e.target.value })} />
        </Field>
      </div>
      <div className="filters ads-inline">
        {DAYS.map((d, i) => (
          <label key={d} className="check-row">
            <input type="checkbox" checked={sched.days.includes(i)} onChange={(e) => setSched({ days: e.target.checked ? [...sched.days, i].sort() : sched.days.filter((x) => x !== i) })} />
            {d}
          </label>
        ))}
        <span className="field-help">No days ticked = every day.</span>
      </div>
    </fieldset>
  );
}

function CreativeEditor({ c, sponsors, onChange, onRemove, onDuplicate }: { c: Creative; sponsors: Sponsor[]; onChange: (p: Partial<Creative>) => void; onRemove: () => void; onDuplicate: () => void }) {
  const sp = sponsors.find((x) => x.id === c.sponsorId);
  return (
    <div className="block-card" style={{ borderStyle: "dashed" }} data-creative={c.id}>
      <div className="filters" style={{ alignItems: "end" }}>
        <Field label="Name">
          <input value={c.name} onChange={(e) => onChange({ name: e.target.value })} />
        </Field>
        <Field label="Type">
          <select value={c.kind} onChange={(e) => onChange({ kind: e.target.value as Creative["kind"] })}>
            <option value="code">Network / custom code</option>
            <option value="sponsor">Direct sponsor banner</option>
            <option value="native">Native card</option>
          </select>
        </Field>
        {c.kind !== "sponsor" ? (
          <Field label="Network">
            <select value={c.network} onChange={(e) => onChange({ network: e.target.value as Creative["network"], isolate: e.target.value === "adsense" ? false : c.isolate })}>
              <option value="adsense">Google AdSense</option>
              <option value="adsterra">Adsterra</option>
              <option value="gam">Google Ad Manager</option>
              <option value="custom">Custom HTML</option>
            </select>
          </Field>
        ) : null}
        <Field label="Weight">
          <input type="number" min={0} max={1000} value={c.weight} onChange={(e) => onChange({ weight: Number(e.target.value) })} />
        </Field>
        <label className="check-row">
          <input type="checkbox" checked={c.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} /> On
        </label>
        <div className="adm-row-actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={onDuplicate}>
            Duplicate
          </button>
          <button type="button" className="btn btn--danger btn--sm" onClick={onRemove}>
            Delete
          </button>
        </div>
      </div>
      {c.kind === "sponsor" || c.kind === "native" ? (
        <Field label="Sponsor" help={sp ? `Links to ${sp.url || "(no URL yet)"} with rel="sponsored noopener" and UTM tags.` : "Add sponsors in the Sponsors tab."}>
          <select value={c.sponsorId} onChange={(e) => onChange({ sponsorId: e.target.value })}>
            <option value="">— choose —</option>
            {sponsors.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name || x.id}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {c.kind === "native" ? (
        <div className="filters">
          <Field label="Headline">
            <input value={c.nativeTitle} onChange={(e) => onChange({ nativeTitle: e.target.value })} />
          </Field>
          <Field label="Text">
            <input value={c.nativeText} onChange={(e) => onChange({ nativeText: e.target.value })} />
          </Field>
        </div>
      ) : null}
      {DEVICES.map((d) => (
        <DeviceCodeEditor key={d} c={c} d={d} onChange={onChange} sponsor={sp} />
      ))}
      {c.kind !== "sponsor" ? (
        <label className="check-row">
          <input type="checkbox" disabled={c.network === "adsense"} checked={c.isolate} onChange={(e) => onChange({ isolate: e.target.checked })} />
          Run in an isolated frame (recommended for Adsterra banner code; not allowed for AdSense)
        </label>
      ) : null}
    </div>
  );
}

/** t167: the code states its own size (Adsterra atOptions); warn when the Size setting differs. */
function CodeSizeCheck({ html, size, onUse }: { html: string; size: AdSize; onUse: (s: AdSize) => void }) {
  const real = codeDims(html);
  if (!real) return null;
  const actual = `${real.w}x${real.h}`;
  if (actual === size) return null;
  const known = (AD_SIZES as readonly string[]).includes(actual);
  return (
    <div className="banner banner--warn ads-size-check" role="status" style={{ gridColumn: "1 / -1", margin: 0 }}>
      <span>
        This code is <strong>{actual}</strong> (from its width and height), but Size is set to <strong>{size}</strong>. The site shows the ad at {actual}, the code's size.
      </span>
      {known ? (
        <button type="button" className="btn btn--sm" onClick={() => onUse(actual as AdSize)}>
          Set Size to {actual}
        </button>
      ) : null}
    </div>
  );
}

function DeviceCodeEditor({ c, d, onChange, sponsor }: { c: Creative; d: Device; onChange: (p: Partial<Creative>) => void; sponsor?: Sponsor }) {
  const v = c[d];
  const label = d === "mobile" ? "Phone" : d === "tablet" ? "Tablet" : "Desktop";
  const set = (p: Partial<typeof v>) => onChange({ [d]: { ...v, ...p } } as Partial<Creative>);
  const banner = sponsor?.banners.find((b) => b.size === v.size);
  return (
    <div className="filters" style={{ alignItems: "start" }}>
      <strong className="ads-device-label">{label}</strong>
      <Field label="Size">
        <select value={v.size} onChange={(e) => set({ size: e.target.value as AdSize })}>
          {AD_SIZES.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </Field>
      {d !== "desktop" ? (
        <label className="check-row">
          <input type="checkbox" checked={v.inherit} onChange={(e) => set({ inherit: e.target.checked })} /> Use desktop
        </label>
      ) : null}
      {c.kind === "code" && !(d !== "desktop" && v.inherit) ? (
        <Field label={`${label} code`} style={{ gridColumn: "1 / -1" }}>
          <textarea rows={4} spellCheck={false} style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.8rem" }} value={v.html} onChange={(e) => set({ html: e.target.value })} placeholder="Paste the ad unit code from your network" />
        </Field>
      ) : null}
      {c.kind === "code" && !(d !== "desktop" && v.inherit) ? <CodeSizeCheck html={v.html} size={v.size} onUse={(size) => set({ size })} /> : null}
      {c.kind === "native" && !(d !== "desktop" && v.inherit) ? (
        <Field label={`${label} native widget code (optional)`} style={{ gridColumn: "1 / -1" }}>
          <textarea rows={2} spellCheck={false} style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.8rem" }} value={v.html} onChange={(e) => set({ html: e.target.value })} />
        </Field>
      ) : null}
      {c.kind === "sponsor" && !(d !== "desktop" && v.inherit) ? (
        <p className="field-help" style={{ gridColumn: "1 / -1", margin: 0 }}>
          {banner ? `Uses ${sponsor!.name}'s ${v.size} banner.` : sponsor ? `${sponsor.name} has no ${v.size} banner yet — upload one in Sponsors.` : "Pick a sponsor."}
        </p>
      ) : null}
    </div>
  );
}

// ---------------- Sponsors ----------------
function SponsorsTab({ s, setS }: { s: AdsSettings; setS: (n: AdsSettings) => void }) {
  const setSp = (id: string, p: Partial<Sponsor>) => setS({ ...s, sponsors: s.sponsors.map((x) => (x.id === id ? { ...x, ...p } : x)) });
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <div className="stack">
      <p className="field-help">
        Direct advertisers. Banners must be exactly the slot size (or exactly double for sharp 2× screens), JPG, PNG, WebP or GIF, 300 KB at most. They are stored in your R2 media
        bucket and link out with rel=&quot;sponsored noopener&quot; in a new tab with UTM tags.
      </p>
      {s.sponsors.map((sp) => (
        <fieldset key={sp.id} className="block-card" data-sponsor={sp.id}>
          <legend>{sp.name || "New sponsor"}</legend>
          <div className="filters">
            <Field label="Name">
              <input value={sp.name} onChange={(e) => setSp(sp.id, { name: e.target.value })} />
            </Field>
            <Field label="Link (https://…)">
              <input value={sp.url} onChange={(e) => setSp(sp.id, { url: e.target.value })} />
            </Field>
          </div>
          <div className="filters">
            <Field label="utm_source">
              <input value={sp.utmSource} onChange={(e) => setSp(sp.id, { utmSource: e.target.value })} />
            </Field>
            <Field label="utm_medium">
              <input value={sp.utmMedium} onChange={(e) => setSp(sp.id, { utmMedium: e.target.value })} />
            </Field>
            <Field label="utm_campaign">
              <input value={sp.utmCampaign} onChange={(e) => setSp(sp.id, { utmCampaign: e.target.value })} />
            </Field>
          </div>
          <div className="filters">
            <Field label="Campaign start (IST)">
              <input type="datetime-local" value={isoToIstInput(sp.start)} onChange={(e) => setSp(sp.id, { start: istInputToIso(e.target.value) })} />
            </Field>
            <Field label="Campaign end (IST)">
              <input type="datetime-local" value={isoToIstInput(sp.end)} onChange={(e) => setSp(sp.id, { end: istInputToIso(e.target.value) })} />
            </Field>
          </div>
          <BannerList sp={sp} onChange={(banners) => setSp(sp.id, { banners })} />
          <Field label="Notes">
            <textarea rows={2} value={sp.notes} onChange={(e) => setSp(sp.id, { notes: e.target.value })} />
          </Field>
          {confirm === sp.id ? (
            <p className="banner banner--bad">
              Delete {sp.name || "this sponsor"}? Slots using it stop showing it.{" "}
              <button type="button" className="btn btn--danger btn--sm" onClick={() => setS({ ...s, sponsors: s.sponsors.filter((x) => x.id !== sp.id) })}>
                Delete
              </button>{" "}
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirm(null)}>
                Cancel
              </button>
            </p>
          ) : (
            <p>
              <button type="button" className="btn btn--danger-ghost btn--sm" onClick={() => setConfirm(sp.id)}>
                Delete sponsor
              </button>
            </p>
          )}
        </fieldset>
      ))}
      <p>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => setS({ ...s, sponsors: [...s.sponsors, { id: uid("sp"), name: "", logoKey: null, url: "", utmSource: "dypol-blog", utmMedium: "banner", utmCampaign: "", start: null, end: null, notes: "", banners: [] }] })}
        >
          Add sponsor
        </button>
      </p>
      <SponsoredArticles s={s} setS={setS} />
    </div>
  );
}

function BannerList({ sp, onChange }: { sp: Sponsor; onChange: (b: Sponsor["banners"]) => void }) {
  const [size, setSize] = useState<AdSize>("300x250");
  const [alt, setAlt] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  async function upload() {
    const f = file.current?.files?.[0];
    setErr(null);
    if (!f) return setErr("Choose a file.");
    if (!alt.trim()) return setErr("Alt text is required (describe the banner for screen readers).");
    if (f.size > 300 * 1024) return setErr(`The file is ${Math.round(f.size / 1024)} KB; the limit is 300 KB.`);
    setBusy(true);
    try {
      const dataBase64 = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1] ?? "");
        r.onerror = () => rej(new Error("Could not read the file."));
        r.readAsDataURL(f);
      });
      const out = await adminUploadBanner({ data: { dataBase64, size, alt } });
      const existing = sp.banners.find((b) => b.size === size);
      const rest = sp.banners.filter((b) => b.size !== size);
      if (out.scale === 2) {
        onChange([...rest, existing ? { ...existing, key2x: out.key, alt } : { size, key: out.key, width: out.width / 2, height: out.height / 2, mime: out.mime, bytes: out.bytes, key2x: out.key, alt }]);
      } else {
        onChange([...rest, { size, key: out.key, width: out.width, height: out.height, mime: out.mime, bytes: out.bytes, key2x: existing?.key2x ?? null, alt }]);
      }
      setAlt("");
      if (file.current) file.current.value = "";
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack" style={{ gap: "0.5rem" }}>
      <span className="adm-group__label">Banners</span>
      {sp.banners.map((b) => (
        <div key={b.size} className="filters" style={{ alignItems: "center" }}>
          <img src={`/ad-media/${b.key.replace(/^ads\//, "")}`} alt={b.alt} style={{ maxWidth: 160, maxHeight: 80, border: "1px solid var(--a-line)", borderRadius: 6 }} />
          <span>
            {b.size} · {Math.round(b.bytes / 1024)} KB · {b.mime}
            {b.key2x && b.key2x !== b.key ? " · 2× ready" : ""}
          </span>
          <Field label="Alt text">
            <input value={b.alt} onChange={(e) => onChange(sp.banners.map((x) => (x.size === b.size ? { ...x, alt: e.target.value } : x)))} />
          </Field>
          <button type="button" className="btn btn--danger-ghost btn--sm" onClick={() => onChange(sp.banners.filter((x) => x.size !== b.size))}>
            Remove
          </button>
        </div>
      ))}
      <div className="filters" style={{ alignItems: "end" }}>
        <Field label="Size">
          <select value={size} onChange={(e) => setSize(e.target.value as AdSize)}>
            {AD_SIZES.filter((x) => x !== "responsive").map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
        <Field label="Image (exact size or 2×)">
          <input ref={file} type="file" accept="image/jpeg,image/png,image/webp,image/gif" />
        </Field>
        <Field label="Alt text (required)">
          <input value={alt} onChange={(e) => setAlt(e.target.value)} />
        </Field>
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void upload()}>
          {busy ? "Uploading…" : "Upload banner"}
        </button>
      </div>
      {err ? <p className="banner banner--bad" role="alert">{err}</p> : null}
      <p className="field-help">Uploading stores the file right away; press Save changes to attach it to the sponsor.</p>
    </div>
  );
}

function SponsoredArticles({ s, setS }: { s: AdsSettings; setS: (n: AdsSettings) => void }) {
  const [slug, setSlug] = useState("");
  const [spId, setSpId] = useState("");
  return (
    <fieldset className="block-card">
      <legend>Sponsored articles</legend>
      <p className="field-help">A sponsored article shows “Sponsored by …” under its byline and no network ads (only direct sponsor creatives).</p>
      {s.sponsoredArticles.map((x) => (
        <div key={x.slug} className="filters" style={{ alignItems: "center" }}>
          <span>
            /articles/{x.slug} → {s.sponsors.find((y) => y.id === x.sponsorId)?.name ?? x.sponsorId}
          </span>
          <button type="button" className="btn btn--danger-ghost btn--sm" onClick={() => setS({ ...s, sponsoredArticles: s.sponsoredArticles.filter((y) => y.slug !== x.slug) })}>
            Remove
          </button>
        </div>
      ))}
      <div className="filters" style={{ alignItems: "end" }}>
        <Field label="Article slug">
          <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="my-article-slug" />
        </Field>
        <Field label="Sponsor">
          <select value={spId} onChange={(e) => setSpId(e.target.value)}>
            <option value="">— choose —</option>
            {s.sponsors.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name || x.id}
              </option>
            ))}
          </select>
        </Field>
        <button
          type="button"
          className="btn btn--ghost"
          disabled={!slug.trim() || !spId}
          onClick={() => {
            const clean = slug.trim().toLowerCase().replace(/^\/?articles\//, "");
            setS({ ...s, sponsoredArticles: [...s.sponsoredArticles.filter((y) => y.slug !== clean), { slug: clean, sponsorId: spId }] });
            setSlug("");
          }}
        >
          Mark as sponsored
        </button>
      </div>
    </fieldset>
  );
}

// ---------------- Scripts & ads.txt ----------------
function ScriptsTab({ s, setS }: { s: AdsSettings; setS: (n: AdsSettings) => void }) {
  const setSc = (id: string, p: Partial<GlobalScript>) => setS({ ...s, scripts: s.scripts.map((x) => (x.id === id ? { ...x, ...p } : x)) });
  return (
    <div className="stack">
      <p className="field-help">
        Site-wide code: AdSense Auto ads / verification, a consent platform (CMP), Adsterra Popunder or Social Bar, analytics for ads. Head code is placed in &lt;head&gt;; body code
        loads at the end of the page. Legal pages, contact, 404, empty searches and the admin never get any of it.
      </p>
      <p className="field-help">
        Verification tags (Search Console, Bing, Pinterest, Yandex) and site-wide analytics that must be in the page HTML whether ads are on or off belong in{" "}
        <a href="/admin/settings#custom-head-code">Settings → Custom head code</a>.
      </p>
      {s.scripts.map((sc) => (
        <fieldset key={sc.id} className="block-card" data-script={sc.id}>
          <legend>{sc.name}</legend>
          <div className="filters">
            <Field label="Name">
              <input value={sc.name} onChange={(e) => setSc(sc.id, { name: e.target.value })} />
            </Field>
            <Field label="Placement">
              <select value={sc.placement} onChange={(e) => setSc(sc.id, { placement: e.target.value as GlobalScript["placement"] })}>
                <option value="head">Head</option>
                <option value="body">Body end</option>
              </select>
            </Field>
            <label className="check-row">
              <input type="checkbox" checked={sc.enabled} onChange={(e) => setSc(sc.id, { enabled: e.target.checked })} /> On
            </label>
            <label className="check-row">
              <input type="checkbox" checked={sc.requiresConsent} onChange={(e) => setSc(sc.id, { requiresConsent: e.target.checked })} /> Wait for consent (turn off for the CMP itself)
            </label>
          </div>
          <Field label="Code">
            <textarea rows={5} spellCheck={false} style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.8rem" }} value={sc.code} onChange={(e) => setSc(sc.id, { code: e.target.value })} />
          </Field>
          <div className="filters ads-inline">
            {PAGE_TYPES.map((p) => (
              <label key={p} className="check-row">
                <input type="checkbox" checked={sc.pages.includes(p)} onChange={(e) => setSc(sc.id, { pages: e.target.checked ? [...sc.pages, p] : sc.pages.filter((x) => x !== p) })} />
                {PAGE_TYPE_LABELS[p]}
              </label>
            ))}
          </div>
          <div className="filters ads-inline">
            {DEVICES.map((d) => (
              <label key={d} className="check-row">
                <input type="checkbox" checked={sc.devices.includes(d)} onChange={(e) => setSc(sc.id, { devices: e.target.checked ? [...sc.devices, d] : sc.devices.filter((x) => x !== d) })} />
                {d}
              </label>
            ))}
          </div>
          <ScheduleEditor sched={sc.schedule} setSched={(p) => setSc(sc.id, { schedule: { ...sc.schedule, ...p } })} />
          <p>
            <button type="button" className="btn btn--danger-ghost btn--sm" onClick={() => window.confirm(`Delete "${sc.name}"?`) && setS({ ...s, scripts: s.scripts.filter((x) => x.id !== sc.id) })}>
              Delete script
            </button>
          </p>
        </fieldset>
      ))}
      <p>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() =>
            setS({
              ...s,
              scripts: [...s.scripts, { id: uid("script"), name: `Script ${s.scripts.length + 1}`, placement: "head", code: "", enabled: false, pages: [...PAGE_TYPES], devices: [...DEVICES], schedule: { start: null, end: null, days: [], from: "", to: "" }, requiresConsent: true }],
            })
          }
        >
          Add script
        </button>
      </p>
      <fieldset className="block-card">
        <legend>ads.txt</legend>
        <p className="field-help">
          Served at <a href="/ads.txt" target="_blank" rel="noopener">/ads.txt</a> (returns “not found” while empty). One line per seller, e.g. <code>google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0</code>.
        </p>
        <textarea rows={6} spellCheck={false} style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.8rem", width: "100%" }} value={s.adsTxt} onChange={(e) => setS({ ...s, adsTxt: e.target.value })} />
      </fieldset>
    </div>
  );
}

// ---------------- Settings ----------------
function SettingsTab({ s, setS }: { s: AdsSettings; setS: (n: AdsSettings) => void }) {
  const r = s.rules;
  const setR = (p: Partial<AdsSettings["rules"]>) => setS({ ...s, rules: { ...r, ...p } });
  const c = s.consent;
  const setC = (p: Partial<AdsSettings["consent"]>) => setS({ ...s, consent: { ...c, ...p } });
  const h = s.house;
  const setH = (p: Partial<AdsSettings["house"]>) => setS({ ...s, house: { ...h, ...p } });
  return (
    <div className="stack">
      <fieldset className="block-card">
        <legend>Ad density (editable defaults — warnings only, never limits)</legend>
        <label className="check-row">
          <input type="checkbox" checked={r.noBackToBack} onChange={(e) => setR({ noBackToBack: e.target.checked })} /> No back-to-back ads (skip an ad that would sit directly after another)
        </label>
        <label className="check-row">
          <input type="checkbox" checked={r.firstMobileScreenOne} onChange={(e) => setR({ firstMobileScreenOne: e.target.checked })} /> On phones, at most one ad on the first screen and none above the headline
        </label>
        <div className="filters">
          <Field label="Max ads inside article text">
            <input type="number" min={0} max={20} value={r.maxInText} onChange={(e) => setR({ maxInText: Number(e.target.value) })} />
          </Field>
          <Field label="First in-text ad after paragraph">
            <input type="number" min={1} max={20} value={r.firstAfterParagraph} onChange={(e) => setR({ firstAfterParagraph: Number(e.target.value) })} />
          </Field>
          <Field label="Paragraphs between in-text ads">
            <input type="number" min={1} max={20} value={r.paragraphsBetween} onChange={(e) => setR({ paragraphsBetween: Number(e.target.value) })} />
          </Field>
          <Field label="A2 needs at least this many paragraphs">
            <input type="number" min={1} max={50} value={r.a2MinParagraphs} onChange={(e) => setR({ a2MinParagraphs: Number(e.target.value) })} />
          </Field>
        </div>
        <div className="filters">
          <label className="check-row">
            <input type="checkbox" checked={r.continueAutoload} disabled onChange={(e) => setR({ continueAutoload: e.target.checked })} /> Continue reading auto-load (not available yet: the site has no infinite article scroll)
          </label>
          <Field label="Max auto-loaded articles">
            <input type="number" min={0} max={10} value={r.continueMax} onChange={(e) => setR({ continueMax: Number(e.target.value) })} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="block-card">
        <legend>Certified consent tool (CMP) head code</legend>
        <p className="field-help">
          Paste the consent tool’s code (Consent Mode default + the CMP loader) exactly as the provider gives it. It is placed first in &lt;head&gt; on every public page, before any ad,
          gtag or GTM code, whether ads are on or off. While it is set, the simple banner below and the analytics cookie bar are switched off so visitors see one consent prompt.
        </p>
        <Field label="Head code">
          <textarea rows={8} spellCheck={false} value={c.cmpHead} onChange={(e) => setC({ cmpHead: e.target.value })} placeholder="<script>…gtag('consent', 'default', …)</script>" />
        </Field>
      </fieldset>

      <fieldset className="block-card">
        <legend>Consent banner</legend>
        <p className="field-help">
          A simple accept/decline banner that holds back ad code until the visitor accepts. It is not a certified Google CMP; for personalised Google ads in the EEA/UK paste a
          certified CMP’s code into Scripts (with “Wait for consent” off) and leave this banner off. Before turning real ads on, update the <a href="/admin/pages">Privacy Policy and Cookie Policy pages</a> so they describe the ad networks and cookies used.
        </p>
        <label className="check-row">
          <input type="checkbox" checked={c.enabled} onChange={(e) => setC({ enabled: e.target.checked })} /> Show the consent banner
        </label>
        <Field label="Who sees it">
          <select value={c.scope} onChange={(e) => setC({ scope: e.target.value as AdsSettings["consent"]["scope"] })}>
            <option value="eea">Visitors in the EEA, UK and Switzerland (by Cloudflare country)</option>
            <option value="all">Everyone</option>
          </select>
        </Field>
        <Field label="Text">
          <textarea rows={2} value={c.text} onChange={(e) => setC({ text: e.target.value })} />
        </Field>
        <div className="filters">
          <Field label="Accept button">
            <input value={c.accept} onChange={(e) => setC({ accept: e.target.value })} />
          </Field>
          <Field label="Decline button">
            <input value={c.reject} onChange={(e) => setC({ reject: e.target.value })} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="block-card">
        <legend>House ad (fallback when a slot has nothing to show)</legend>
        <div className="filters">
          <Field label="Headline">
            <input value={h.title} onChange={(e) => setH({ title: e.target.value })} />
          </Field>
          <Field label="Link (/path or https://…)">
            <input value={h.url} onChange={(e) => setH({ url: e.target.value })} />
          </Field>
        </div>
        <div className="filters">
          <Field label="Text">
            <input value={h.text} onChange={(e) => setH({ text: e.target.value })} />
          </Field>
          <Field label="Button text">
            <input value={h.cta} onChange={(e) => setH({ cta: e.target.value })} />
          </Field>
        </div>
        <p className="field-help">Used only by slots with “Show the house ad when nothing fills” ticked.</p>
      </fieldset>

      <fieldset className="block-card">
        <legend>Network dashboards</legend>
        <div className="filters">
          {(["adsense", "adsterra", "gam"] as const).map((k) => (
            <Field key={k} label={k === "gam" ? "Google Ad Manager" : k === "adsense" ? "AdSense" : "Adsterra"}>
              <input value={s.networks[k]} onChange={(e) => setS({ ...s, networks: { ...s.networks, [k]: e.target.value } })} />
            </Field>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

// ---------------- Stats ----------------
function StatsTab({ s }: { s: AdsSettings }) {
  const [days, setDays] = useState(7);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof adminAdStats>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function load(d: number) {
    setDays(d);
    setErr(null);
    try {
      setRows(await adminAdStats({ data: { days: d } }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load stats.");
    }
  }
  const bySlot = useMemo(() => {
    const m = new Map<string, { imp: number; clk: number }>();
    for (const r of rows ?? []) {
      const x = m.get(r.slot) ?? { imp: 0, clk: 0 };
      x.imp += r.impressions;
      x.clk += r.clicks;
      m.set(r.slot, x);
    }
    return [...m.entries()].sort((a, b) => b[1].imp - a[1].imp);
  }, [rows]);
  const csv = () => {
    const lines = ["day,slot,creative,sponsor,impressions,clicks", ...(rows ?? []).map((r) => [r.day, r.slot, r.creative, r.sponsor, r.impressions, r.clicks].join(","))];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = `ad-stats-${days}d.csv`;
    a.click();
  };
  return (
    <div className="stack">
      <p className="field-help">
        First-party counts: a view is counted when at least half the ad is on screen for one second; clicks are counted for sponsor banners, native cards and house ads (network
        clicks are reported by the network). Days are India days (IST).
      </p>
      <div className="adm-row-actions">
        <button type="button" className={`adm-chip${days === 7 && rows ? " adm-chip--active" : ""}`} onClick={() => void load(7)}>
          Last 7 days
        </button>
        <button type="button" className={`adm-chip${days === 30 && rows ? " adm-chip--active" : ""}`} onClick={() => void load(30)}>
          Last 30 days
        </button>
        {rows ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={csv}>
            Download CSV
          </button>
        ) : null}
        <a className="btn btn--ghost btn--sm" href={s.networks.adsense} target="_blank" rel="noopener">
          AdSense ↗
        </a>
        <a className="btn btn--ghost btn--sm" href={s.networks.adsterra} target="_blank" rel="noopener">
          Adsterra ↗
        </a>
        <a className="btn btn--ghost btn--sm" href={s.networks.gam} target="_blank" rel="noopener">
          Ad Manager ↗
        </a>
      </div>
      {err ? <p className="banner banner--bad">{err}</p> : null}
      {rows ? (
        bySlot.length ? (
          <div className="adm-table-wrap">
            <table className="desk-table adm-table--compact">
              <thead>
                <tr>
                  <th>Slot</th>
                  <th>Views</th>
                  <th>Clicks</th>
                  <th>CTR</th>
                </tr>
              </thead>
              <tbody>
                {bySlot.map(([slot, x]) => (
                  <tr key={slot}>
                    <td>{slot}</td>
                    <td>{x.imp.toLocaleString()}</td>
                    <td>{x.clk.toLocaleString()}</td>
                    <td>{x.imp ? `${((x.clk / x.imp) * 100).toFixed(2)}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="field-help">No ad views recorded in this period.</p>
        )
      ) : (
        <p className="field-help">Pick a period to load the numbers.</p>
      )}
    </div>
  );
}

// ---------------- History ----------------
function HistoryTab({ audit, onRestored }: { audit: { createdAt: string; actor: string | null; action: string; detail: string }[]; onRestored: (n: AdsSettings) => void }) {
  const [slot, setSlot] = useState<string>(SLOT_CATALOG[0].id);
  const [versions, setVersions] = useState<Awaited<ReturnType<typeof adminAdVersions>> | null>(null);
  return (
    <div className="stack">
      <fieldset className="block-card">
        <legend>Slot versions (last 10 per slot)</legend>
        <div className="filters" style={{ alignItems: "end" }}>
          <Field label="Slot">
            <select value={slot} onChange={(e) => { setSlot(e.target.value); setVersions(null); }}>
              {SLOT_CATALOG.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.id} · {d.name}
                </option>
              ))}
            </select>
          </Field>
          <button type="button" className="btn btn--ghost" onClick={async () => setVersions(await adminAdVersions({ data: { slotId: slot } }))}>
            Show versions
          </button>
        </div>
        {versions?.length === 0 ? <p className="field-help">No earlier versions.</p> : null}
        {versions?.map((v) => (
          <div key={v.id} className="filters" style={{ alignItems: "center" }}>
            <span>
              {fmtIst(v.createdAt)} · {v.actor ?? "editor"} · {v.slot.creatives.length} creative(s), {v.slot.enabled ? "on" : "off"}
            </span>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={async () => {
                if (!window.confirm(`Restore this version of ${slot}? It goes live now.`)) return;
                const out = await adminRestoreAdVersion({ data: { versionId: v.id } });
                onRestored(normalizeAdsSettings(out.settings));
              }}
            >
              Restore
            </button>
          </div>
        ))}
      </fieldset>
      <fieldset className="block-card">
        <legend>Audit log</legend>
        {audit.length === 0 ? <p className="field-help">No changes yet.</p> : null}
        <ul className="ads-audit">
          {audit.map((a, i) => (
            <li key={i}>
              <small className="adm-muted">{fmtIst(a.createdAt)}</small> · {a.actor ?? "editor"} · <strong>{a.action}</strong> — {a.detail}
            </li>
          ))}
        </ul>
      </fieldset>
    </div>
  );
}

// ---------------- Test sandbox ----------------
function SandboxTab() {
  const [code, setCode] = useState("");
  const [size, setSize] = useState<AdSize>("300x250");
  const [run, setRun] = useState(0);
  const dims = size === "responsive" ? { w: 600, h: 250 } : { w: Number(size.split("x")[0]), h: Number(size.split("x")[1]) };
  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100%;font:12px system-ui}</style></head><body>${code}<script>window.onerror=function(m){document.body.insertAdjacentHTML('beforeend','<pre style="color:#b00;white-space:pre-wrap">'+String(m).replace(/</g,'&lt;')+'</pre>')}</script></body></html>`;
  return (
    <div className="stack">
      <p className="field-help">
        Paste ad code to try it in a sealed frame before putting it in a slot. Nothing here is saved or shown to visitors. Some networks only serve on the approved domain, so a blank
        result here is not always a problem.
      </p>
      <div className="filters" style={{ alignItems: "end" }}>
        <Field label="Size">
          <select value={size} onChange={(e) => setSize(e.target.value as AdSize)}>
            {AD_SIZES.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
        <button type="button" className="btn" onClick={() => setRun((n) => n + 1)}>
          Run test
        </button>
      </div>
      <textarea rows={8} spellCheck={false} style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.8rem", width: "100%" }} value={code} onChange={(e) => setCode(e.target.value)} />
      {run ? (
        <iframe key={run} title="Ad code test" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} width={dims.w} height={dims.h} style={{ border: "1px dashed #999", maxWidth: "100%", background: "#fff" }} />
      ) : null}
    </div>
  );
}
