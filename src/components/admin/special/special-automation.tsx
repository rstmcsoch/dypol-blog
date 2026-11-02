/**
 * t173: Automation → Special tab. The same engine, MCP endpoint and profiles as
 * Normal automation; these settings only decide what AI special articles may do.
 */
import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { errorText } from "@/components/admin/gate";
import { adminCloudAction, adminCloudConnect, adminSaveSpecialSettings } from "@/content/admin-api";
import { CLOUD_PROVIDERS, IMAGE_PROVIDERS, PUBLISH_BEHAVIOURS, RESEARCH_DEPTHS, type SpecialSettings } from "@/lib/special/settings";
import type { CloudStatus } from "@/content/cloud.server";
import { CombinedLimitNote, type PublishUsageView } from "./combined-limit";

type Props = {
  settings: SpecialSettings;
  categories: Array<{ id: string; slug: string; label: string }>;
  profiles: Array<{ id: string; name: string }>;
  keys: { xai: boolean; openai: boolean; brave: boolean };
  cloud: CloudStatus[];
  publishUsage: PublishUsageView;
  flash: { provider?: string; connected?: boolean; error?: string };
};

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DEPTH_TEXT: Record<(typeof RESEARCH_DEPTHS)[number], string> = { standard: "Standard — 5+ sources", deep: "Deep — 10+ sources, academic search", exhaustive: "Exhaustive — 20+ sources, fact-check every claim" };
const PUBLISH_TEXT: Record<(typeof PUBLISH_BEHAVIOURS)[number], { title: string; text: string }> = {
  draft: { title: "Always draft", text: "AI specials are saved as drafts. Nothing is published by AI." },
  "owner-review": { title: "Owner review (recommended)", text: "Drafts are flagged for your review; you publish from the editor." },
  "auto-if-passes": { title: "Auto-publish if it passes", text: "Published only when the quality report passes and your Normal publishing rules and daily caps allow it." },
};
const IMAGE_TEXT: Record<(typeof IMAGE_PROVIDERS)[number], string> = { none: "No AI images", xai: "xAI (Grok image)", openai: "OpenAI (gpt-image-1)" };
const CLOUD_LABEL: Record<(typeof CLOUD_PROVIDERS)[number], string> = { "google-drive": "Google Drive", onedrive: "OneDrive", dropbox: "Dropbox", "proton-drive": "Proton Drive (links)" };

export function SpecialAutomation(props: Props) {
  const router = useRouter();
  const [s, setS] = useState<SpecialSettings>(props.settings);
  const [feeds, setFeeds] = useState(props.settings.rssFeeds.join("\n"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const set = <K extends keyof SpecialSettings>(k: K, v: SpecialSettings[K]) => setS((c) => ({ ...c, [k]: v }));
  const sub = <K extends "schedule" | "sources" | "cloud" | "images" | "seo">(k: K, v: Partial<SpecialSettings[K]>) => setS((c) => ({ ...c, [k]: { ...c[k], ...v } }));
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const save = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const payload = { ...s, rssFeeds: feeds.split(/\s+/).map((f) => f.trim()).filter(Boolean) };
      const r = await adminSaveSpecialSettings({ data: payload });
      if (!r.ok) setError(r.error);
      else {
        setS(r.settings);
        setFeeds(r.settings.rssFeeds.join("\n"));
        setMessage(r.settings.enabled ? (r.settings.eligibleCategoryIds.length ? "Saved. AI special articles are on for the approved categories." : "Saved, but no categories are approved — AI cannot write specials yet.") : "Saved. AI special articles are off.");
        void router.invalidate();
      }
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const gateOff = s.enabled && s.eligibleCategoryIds.length === 0;
  return (
    <div className="sp-auto" data-testid="special-automation">
      <section className="sp-card sp-card--lead">
        <div className="sp-auto__head">
          <div>
            <p className="desk-kicker">Special articles</p>
            <h2 className="sp-card__title">AI special-article automation</h2>
            <p className="desk-note">Same AI apps, same <code>/mcp</code> endpoint and profiles as Normal. An AI writes a special article by calling <code>submit_article_draft</code> with <code>article_type: "special"</code>; anything else stays a normal article.</p>
          </div>
          <label className="sp-switch">
            <input type="checkbox" checked={s.enabled} onChange={(e) => set("enabled", e.target.checked)} data-testid="special-enabled" />
            <span className="sp-switch__track" aria-hidden="true" />
            <span>{s.enabled ? "On" : "Off"}</span>
          </label>
        </div>
        {gateOff ? <p className="banner banner--warn" role="status">Choose at least one eligible category — until then AI special articles stay blocked.</p> : null}
      </section>

      <div className="sp-auto__grid">
        <section className="sp-card" aria-labelledby="sp-c2">
          <h3 id="sp-c2" className="sp-card__title"><span className="sp-num">1</span> Eligible categories</h3>
          <p className="desk-note">AI special articles may only be filed under these topics. Every topic of a submission must be approved; the AI's own classification cannot widen this list.</p>
          <div className="sp-chips" role="group" aria-label="Eligible categories">
            {props.categories.map((c) => (
              <button key={c.id} type="button" className={`sp-chip${s.eligibleCategoryIds.includes(c.id) ? " is-on" : ""}`} aria-pressed={s.eligibleCategoryIds.includes(c.id)} onClick={() => set("eligibleCategoryIds", toggle(s.eligibleCategoryIds, c.id))}>{c.label}</button>
            ))}
          </div>
        </section>

        <section className="sp-card" aria-labelledby="sp-c1">
          <h3 id="sp-c1" className="sp-card__title"><span className="sp-num">2</span> Profiles</h3>
          <p className="desk-note">Which automation profiles may write specials. None selected = all profiles.</p>
          <div className="sp-chips">
            {props.profiles.map((p) => (
              <button key={p.id} type="button" className={`sp-chip${s.profileIds.includes(p.id) ? " is-on" : ""}`} aria-pressed={s.profileIds.includes(p.id)} onClick={() => set("profileIds", toggle(s.profileIds, p.id))}>{p.name}</button>
            ))}
          </div>
        </section>

        <section className="sp-card sp-span-2" aria-labelledby="sp-c3">
          <h3 id="sp-c3" className="sp-card__title"><span className="sp-num">3</span> Topic instructions</h3>
          <label className="field"><span className="field__label">Guidance sent to the AI with every special run</span>
            <textarea rows={4} maxLength={4000} value={s.topicInstructions} onChange={(e) => set("topicInstructions", e.target.value)} placeholder="Deep dives on Indian energy policy, with primary data and academic sources…" />
          </label>
        </section>

        <section className="sp-card" aria-labelledby="sp-c4">
          <h3 id="sp-c4" className="sp-card__title"><span className="sp-num">4</span> Research depth</h3>
          <div className="sp-radios">
            {RESEARCH_DEPTHS.map((d) => (
              <label key={d} className={`sp-radio${s.researchDepth === d ? " is-on" : ""}`}><input type="radio" name="sp-depth" checked={s.researchDepth === d} onChange={() => set("researchDepth", d)} /> {DEPTH_TEXT[d]}</label>
            ))}
          </div>
        </section>

        <section className="sp-card" aria-labelledby="sp-c5">
          <h3 id="sp-c5" className="sp-card__title"><span className="sp-num">5</span> Length</h3>
          <div className="sp-row-card__grid">
            <label className="field"><span className="field__label">Minimum words</span><input type="number" min={300} max={20000} step={100} value={s.minWords} onChange={(e) => set("minWords", Number(e.target.value))} /></label>
            <label className="field"><span className="field__label">Target words</span><input type="number" min={300} max={30000} step={100} value={s.targetWords} onChange={(e) => set("targetWords", Number(e.target.value))} /></label>
          </div>
        </section>

        <section className="sp-card" aria-labelledby="sp-c6">
          <h3 id="sp-c6" className="sp-card__title"><span className="sp-num">6</span> Frequency</h3>
          <label className="field"><span className="field__label">AI specials per rolling 7 days (0 = no cap)</span><input type="number" min={0} max={50} value={s.maxPerWeek} onChange={(e) => set("maxPerWeek", Number(e.target.value))} /></label>
          <label className="field"><span className="field__label">AI special publishes per day (0 = no own cap)</span><input type="number" min={0} max={50} value={s.maxPublishedPerDay} onChange={(e) => set("maxPublishedPerDay", Number(e.target.value))} data-testid="special-per-day" /></label>
          <CombinedLimitNote usage={props.publishUsage} tab="special" />
        </section>

        <section className="sp-card" aria-labelledby="sp-c7">
          <h3 id="sp-c7" className="sp-card__title"><span className="sp-num">7</span> Schedule</h3>
          <p className="desk-note">Your AI app runs the schedule; this is the expectation shown to it and on Health.</p>
          <div className="sp-days" role="group" aria-label="Days">
            {DAYS.map((d) => (
              <button key={d} type="button" className={`sp-chip sp-chip--day${s.schedule.days.includes(d) ? " is-on" : ""}`} aria-pressed={s.schedule.days.includes(d)} onClick={() => sub("schedule", { days: toggle(s.schedule.days, d) })}>{d.slice(0, 1).toUpperCase() + d.slice(1)}</button>
            ))}
          </div>
          <div className="sp-row-card__grid">
            <label className="field"><span className="field__label">Time</span><input type="time" value={s.schedule.time} onChange={(e) => sub("schedule", { time: e.target.value })} /></label>
            <label className="field"><span className="field__label">Timezone</span><input value={s.schedule.timezone} onChange={(e) => sub("schedule", { timezone: e.target.value })} /></label>
          </div>
        </section>

        <section className="sp-card" aria-labelledby="sp-c8">
          <h3 id="sp-c8" className="sp-card__title"><span className="sp-num">8</span> Required sources</h3>
          <div className="sp-row-card__grid">
            <label className="field"><span className="field__label">References (min)</span><input type="number" min={0} max={50} value={s.sources.minSources} onChange={(e) => sub("sources", { minSources: Number(e.target.value) })} /></label>
            <label className="field"><span className="field__label">Academic (min)</span><input type="number" min={0} max={20} value={s.sources.minAcademic} onChange={(e) => sub("sources", { minAcademic: Number(e.target.value) })} /></label>
          </div>
          <label className="sp-check"><input type="checkbox" checked={s.sources.requireVerification} onChange={(e) => sub("sources", { requireVerification: e.target.checked })} /> Require a fact-check report (fact_check_claims) before an AI special can leave draft</label>
        </section>

        <section className="sp-card" aria-labelledby="sp-c9">
          <h3 id="sp-c9" className="sp-card__title"><span className="sp-num">9</span> File integrations</h3>
          <p className="desk-note">Which connected storage the AI may use. A provider also has to be connected below.</p>
          <div className="sp-chips">
            {CLOUD_PROVIDERS.map((p) => {
              const st = props.cloud.find((c) => c.provider === p);
              const live = st?.status === "connected" || st?.status === "manual";
              return (
                <button key={p} type="button" className={`sp-chip${s.cloud.providers.includes(p) ? " is-on" : ""}`} aria-pressed={s.cloud.providers.includes(p)} onClick={() => sub("cloud", { providers: toggle(s.cloud.providers, p) })}>
                  {CLOUD_LABEL[p]} <span className={`sp-dot${live ? " is-ok" : ""}`} aria-label={live ? "connected" : "not connected"} />
                </button>
              );
            })}
          </div>
          <label className="sp-check"><input type="checkbox" checked={s.cloud.allowShareLinks} onChange={(e) => sub("cloud", { allowShareLinks: e.target.checked })} /> Allow the AI to create public share links (create_cloud_share_link)</label>
          <label className="sp-check"><input type="checkbox" checked={s.cloud.allowUpload} onChange={(e) => sub("cloud", { allowUpload: e.target.checked })} /> Allow the AI to upload generated documents (upload_generated_document)</label>
        </section>

        <section className="sp-card" aria-labelledby="sp-c10">
          <h3 id="sp-c10" className="sp-card__title"><span className="sp-num">10</span> Image generation</h3>
          <div className="sp-radios">
            {IMAGE_PROVIDERS.map((p) => {
              const missing = p === "xai" ? !props.keys.xai : p === "openai" ? !props.keys.openai : false;
              return (
                <label key={p} className={`sp-radio${s.images.provider === p ? " is-on" : ""}`}>
                  <input type="radio" name="sp-img" checked={s.images.provider === p} onChange={() => sub("images", { provider: p })} /> {IMAGE_TEXT[p]}
                  {missing ? <span className="sp-pill">key not set</span> : p !== "none" ? <span className="sp-pill sp-pill--ok">key set</span> : null}
                </label>
              );
            })}
          </div>
          <label className="field"><span className="field__label">Max images per article</span><input type="number" min={0} max={8} value={s.images.maxPerArticle} onChange={(e) => sub("images", { maxPerArticle: Number(e.target.value) })} /></label>
        </section>

        <section className="sp-card" aria-labelledby="sp-c11">
          <h3 id="sp-c11" className="sp-card__title"><span className="sp-num">11</span> SEO requirements</h3>
          <label className="sp-check"><input type="checkbox" checked={s.seo.requireFeaturedImage} onChange={(e) => sub("seo", { requireFeaturedImage: e.target.checked })} /> Featured image required</label>
          <label className="sp-check"><input type="checkbox" checked={s.seo.requireAltText} onChange={(e) => sub("seo", { requireAltText: e.target.checked })} /> Alt text on every image</label>
          <div className="sp-row-card__grid sp-row-card__grid--3">
            <label className="field"><span className="field__label">H1 sections (min)</span><input type="number" min={0} max={30} value={s.seo.minSections} onChange={(e) => sub("seo", { minSections: Number(e.target.value) })} /></label>
            <label className="field"><span className="field__label">Title max chars</span><input type="number" min={30} max={120} value={s.seo.maxTitleChars} onChange={(e) => sub("seo", { maxTitleChars: Number(e.target.value) })} /></label>
            <label className="field"><span className="field__label">Description min chars</span><input type="number" min={0} max={160} value={s.seo.minDescriptionChars} onChange={(e) => sub("seo", { minDescriptionChars: Number(e.target.value) })} /></label>
          </div>
        </section>

        <section className="sp-card" aria-labelledby="sp-c12">
          <h3 id="sp-c12" className="sp-card__title"><span className="sp-num">12</span> Draft / publish behaviour</h3>
          <div className="sp-radios">
            {PUBLISH_BEHAVIOURS.map((b) => (
              <label key={b} className={`sp-radio sp-radio--block${s.publishBehaviour === b ? " is-on" : ""}`}>
                <input type="radio" name="sp-pub" checked={s.publishBehaviour === b} onChange={() => set("publishBehaviour", b)} data-testid={`publish-${b}`} />
                <span><strong>{PUBLISH_TEXT[b].title}</strong><br /><span className="desk-note">{PUBLISH_TEXT[b].text}</span></span>
              </label>
            ))}
          </div>
        </section>

        <section className="sp-card sp-span-2" aria-labelledby="sp-rss">
          <h3 id="sp-rss" className="sp-card__title">RSS feeds to monitor</h3>
          <p className="desk-note">One https feed per line (max 20). The AI reads new items with <code>check_rss_feeds</code>; items it has seen are never returned again.</p>
          <textarea rows={4} value={feeds} onChange={(e) => setFeeds(e.target.value)} placeholder="https://example.org/feed.xml" aria-label="RSS feeds" />
        </section>
      </div>

      <div className="sp-savebar">
        {error ? <p className="banner banner--bad" role="alert">{error}</p> : null}
        {message ? <p className="banner" role="status">{message}</p> : null}
        <button type="button" className="btn" disabled={busy} onClick={() => void save()} data-testid="special-save">{busy ? "Saving…" : "Save special settings"}</button>
        <span className="desk-note">Research tools always available to AI specials: web_search, extract_page, academic_search, manage_citations, fact_check_claims, analyze_dataset, validate_links, check_rss_feeds, special_quality_report{props.settings.images.provider !== "none" ? ", generate_special_image" : ""}.</span>
      </div>

      <CloudConnectors cloud={props.cloud} flash={props.flash} />
    </div>
  );
}

function statusText(c: CloudStatus): { text: string; tone: "ok" | "warn" | "bad" | "off" } {
  if (c.status === "connected") return { text: "Connected", tone: "ok" };
  if (c.status === "manual") return { text: `${c.links.length} link(s)`, tone: "ok" };
  if (c.status === "error") return { text: "Needs attention", tone: "bad" };
  if (c.status === "not-configured") return { text: "Not configured", tone: "off" };
  return { text: "Not connected", tone: "warn" };
}

function CloudConnectors({ cloud, flash }: { cloud: CloudStatus[]; flash: Props["flash"] }) {
  return (
    <section className="sp-card sp-cloud" id="cloud" aria-labelledby="cloud-h">
      <h2 id="cloud-h" className="sp-card__title">Cloud storage connectors</h2>
      <p className="desk-note">Read-only by default. Tokens are encrypted on the server and never shown to the browser or the AI. A provider shows “Connected” only after a real sign-in succeeded.</p>
      {flash.provider && flash.connected ? <p className="banner" role="status">{flash.provider} connected.</p> : null}
      {flash.provider && flash.error ? <p className="banner banner--bad" role="alert">{flash.provider}: {flash.error}</p> : null}
      <div className="sp-cloud__grid">
        {cloud.map((c) => <CloudCard key={c.provider} c={c} />)}
      </div>
    </section>
  );
}

function CloudCard({ c }: { c: CloudStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [share, setShare] = useState(c.capabilities.includes("share"));
  const [upload, setUpload] = useState(c.capabilities.includes("upload"));
  const [browse, setBrowse] = useState<{ stack: Array<{ id: string | null; name: string }>; items: Array<{ id: string; name: string; path?: string | null }> } | null>(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const st = statusText(c);
  // Set after hydration so the server HTML and the first client render match.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const act = async (fn: () => Promise<{ ok: boolean; error?: string } & Record<string, unknown>>, after?: (r: Record<string, unknown>) => void) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Failed.");
      else {
        after?.(r);
        void router.invalidate();
      }
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };
  const connect = () => act(() => adminCloudConnect({ data: { provider: c.provider, share, upload } }), (r) => { window.location.href = String(r.url); });
  const open = (id: string | null, name: string, stack: Array<{ id: string | null; name: string }>) =>
    act(() => adminCloudAction({ data: { provider: c.provider, action: "browse", folderId: id } }), (r) => setBrowse({ stack: [...stack, { id, name }], items: r.items as Array<{ id: string; name: string; path?: string | null }> }));
  const choose = (f: { id: string; name: string; path?: string | null }) => act(() => adminCloudAction({ data: { provider: c.provider, action: "folders", folders: [...c.folders.filter((x) => x.id !== f.id), f] } }), () => setNote(`Folder “${f.name}” selected.`));
  const unchoose = (id: string) => act(() => adminCloudAction({ data: { provider: c.provider, action: "folders", folders: c.folders.filter((x) => x.id !== id) } }));

  return (
    <article className={`sp-conn sp-conn--${st.tone}`} data-testid={`cloud-${c.provider}`}>
      <header className="sp-conn__head">
        <h3>{c.label}</h3>
        <span className={`sp-pill sp-pill--${st.tone}`} data-testid={`cloud-status-${c.provider}`}>{st.text}</span>
      </header>
      {c.account ? <p className="sp-conn__acct">Account: <strong>{c.account}</strong></p> : null}
      {c.kind === "oauth" && c.missing.length ? (
        <div className="sp-conn__setup">
          <p><strong>Setup needed.</strong> Add these Worker secrets, then reload:</p>
          <ul>{c.missing.map((m) => <li key={m}><code>{m}</code></li>)}</ul>
          <p className="desk-note">{c.setup}</p>
          {c.redirectPath ? <p className="desk-note">Redirect URI to register: <code className="sp-break">{origin}{c.redirectPath}</code></p> : null}
        </div>
      ) : null}
      <ul className="sp-perms">
        {c.permissions.map((p) => (
          <li key={p.capability} className={p.granted ? "is-ok" : ""}><span className="sp-perms__cap">{p.capability}</span> {p.text}</li>
        ))}
      </ul>
      {c.kind === "oauth" && !c.missing.length ? (
        <>
          <div className="sp-conn__opts">
            <label className="sp-check"><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /> Allow share links</label>
            <label className="sp-check"><input type="checkbox" checked={upload} onChange={(e) => setUpload(e.target.checked)} /> Allow uploads</label>
          </div>
          <div className="sp-conn__actions">
            <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void connect()}>{c.status === "connected" ? "Reauthorize" : "Connect"}</button>
            {c.status === "connected" || c.status === "error" ? (
              <>
                <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void act(() => adminCloudAction({ data: { provider: c.provider, action: "test" } }), (r) => setNote((r.test as { detail: string }).detail))}>Test</button>
                <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void open(null, "Root", [])}>Choose folders</button>
                <button type="button" className="btn btn--danger btn--sm" disabled={busy} onClick={() => { if (window.confirm(`Disconnect ${c.label}? Stored tokens are deleted.`)) void act(() => adminCloudAction({ data: { provider: c.provider, action: "disconnect" } })); }}>Disconnect</button>
              </>
            ) : null}
          </div>
          {c.redirectPath ? <p className="desk-note sp-break">Redirect URI: <code>{origin}{c.redirectPath}</code></p> : null}
        </>
      ) : null}
      {c.kind === "oauth" && c.folders.length ? (
        <div className="sp-conn__folders">
          <p className="desk-note">AI access limited to:</p>
          <div className="sp-chips">{c.folders.map((f) => <span key={f.id} className="sp-chip is-on">{f.name} <button type="button" className="sp-chip__x" aria-label={`Remove ${f.name}`} onClick={() => void unchoose(f.id)}>×</button></span>)}</div>
        </div>
      ) : c.status === "connected" ? <p className="desk-note">No folder restriction: the AI can see the whole drive (read-only). Choose folders to narrow it.</p> : null}
      {browse ? (
        <div className="sp-browse" role="dialog" aria-label="Choose a folder">
          <div className="sp-browse__crumbs">{browse.stack.map((b, i) => <button key={`${b.id}-${i}`} type="button" className="btn btn--ghost btn--sm" onClick={() => void open(b.id, b.name, browse.stack.slice(0, i))}>{b.name}</button>)}</div>
          {browse.items.length ? (
            <ul className="sp-browse__list">
              {browse.items.map((f) => (
                <li key={f.id}>
                  <button type="button" className="sp-browse__open" onClick={() => void open(f.id, f.name, browse.stack)}>📁 {f.name}</button>
                  <button type="button" className="btn btn--sm" onClick={() => void choose(f)}>Select</button>
                </li>
              ))}
            </ul>
          ) : <p className="desk-note">No sub-folders here.</p>}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setBrowse(null)}>Close</button>
        </div>
      ) : null}
      {c.kind === "manual" ? (
        <div className="sp-proton">
          <form className="sp-inline" onSubmit={(e) => { e.preventDefault(); void act(() => adminCloudAction({ data: { provider: c.provider, action: "proton-add", title, url } }), () => { setTitle(""); setUrl(""); }); }}>
            <input aria-label="Link title" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <input aria-label="Proton share URL" placeholder="https://drive.proton.me/urls/…" value={url} onChange={(e) => setUrl(e.target.value)} required />
            <button type="submit" className="btn btn--sm" disabled={busy}>Add link</button>
          </form>
          {c.links.length ? (
            <ul className="sp-links">
              {c.links.map((l) => <li key={l.id}><a href={l.url} target="_blank" rel="noopener noreferrer">{l.title}</a> <button type="button" className="btn btn--ghost btn--sm" onClick={() => void act(() => adminCloudAction({ data: { provider: c.provider, action: "proton-remove", id: l.id } }))}>Remove</button></li>)}
            </ul>
          ) : null}
        </div>
      ) : null}
      {c.lastTest ? <p className={`desk-note sp-conn__test${c.lastTest.ok ? " is-ok" : " is-bad"}`}>Last test {new Date(c.lastTest.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST: {c.lastTest.detail}</p> : null}
      {note ? <p className="banner" role="status">{note}</p> : null}
      {error ? <p className="banner banner--bad" role="alert">{error}</p> : null}
    </article>
  );
}
