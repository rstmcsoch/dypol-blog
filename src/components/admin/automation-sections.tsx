/**
 * t178/t179: Automation Normal | Special as a two-pill segmented control, the exclusive
 * profile Section picker (same look), and the shared "new profile" form.
 *
 * One source of truth: a profile is Special when it is listed in the special settings'
 * profileIds; every other profile is Normal. All UI here changes that list only through
 * the "section" profile action (or `section` on create).
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "@tanstack/react-router";
import { errorText } from "@/components/admin/gate";
import { adminProfileAction } from "@/content/admin-api";
import { checkAuthorName, sameAuthor } from "@/lib/author-name";

export type Section = "normal" | "special";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The confirmation text shown before a profile changes section. */
export function assignConfirmText(name: string, to: Section): string {
  return to === "special"
    ? `${name} will stop writing normal articles. It will only be able to write special articles (submit_article_draft with article_type: "special"). Continue?`
    : `${name} will stop writing special articles and go back to writing normal articles only. Continue?`;
}

/** Ask, then save the assignment. Resolves true when it changed. */
export async function assignSection(profile: { id: string; name: string }, to: Section, confirm: (text: string) => boolean = (t) => window.confirm(t)): Promise<boolean> {
  if (!confirm(assignConfirmText(profile.name, to))) return false;
  await adminProfileAction({ data: { action: "section", profileId: profile.id, section: to } });
  return true;
}

type TabsProps = {
  active: Section;
  normalCount: number;
  specialCount: number;
  specialOn: boolean;
  profile?: string;
};

/** Normal | Special tabs: two equal pills with an orange indicator that slides between them. */
export function AutomationTabs({ active, normalCount, specialCount, specialOn, profile }: TabsProps) {
  // Optimistic: the indicator moves on click, before the URL/panel update lands.
  const [shown, setShown] = useState<Section>(active);
  useEffect(() => setShown(active), [active]);
  const refs = useRef<Record<Section, HTMLAnchorElement | null>>({ normal: null, special: null });
  const items: Array<{ id: Section; label: string; sub: string }> = [
    { id: "normal", label: "Normal", sub: plural(normalCount, "profile") },
    { id: "special", label: "Special", sub: `${specialOn ? "On" : "Off"} · ${plural(specialCount, "profile")}` },
  ];
  const searchFor = (id: Section) => ({ ...(profile ? { profile } : {}), ...(id === "special" ? { tab: "special" as const } : {}) });
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, Section | undefined> = { ArrowLeft: "normal", ArrowUp: "normal", Home: "normal", ArrowRight: "special", ArrowDown: "special", End: "special" };
    const next = keys[e.key];
    if (!next) return;
    e.preventDefault();
    const el = refs.current[next];
    el?.focus();
    if (next !== shown) el?.click();
  };
  return (
    <div className="auto-seg auto-seg--tabs" role="tablist" aria-label="Automation type" data-active={shown} onKeyDown={onKey} data-testid="automation-tabs">
      <span className="auto-seg__indicator" aria-hidden="true" />
      {items.map((it) => (
        <Link
          key={it.id}
          ref={(el: HTMLAnchorElement | null) => { refs.current[it.id] = el; }}
          to="/admin/automation"
          search={searchFor(it.id)}
          role="tab"
          id={`auto-tab-${it.id}`}
          aria-selected={shown === it.id}
          aria-controls="auto-panel"
          tabIndex={shown === it.id ? 0 : -1}
          className={`auto-seg__pill${shown === it.id ? " is-active" : ""}`}
          data-testid={`tab-${it.id}`}
          onClick={() => setShown(it.id)}
        >
          <span className="auto-seg__label">{it.label}<span className="auto-seg__long"> articles</span></span>
          <span className="auto-seg__sub">{it.sub}</span>
        </Link>
      ))}
    </div>
  );
}

/** Section choice for a profile, styled like the tabs (a radio group). */
export function SectionPicker({ value, onChange, name, disabled, testId }: { value: Section; onChange: (s: Section) => void; name: string; disabled?: boolean; testId?: string }) {
  const opts: Array<{ id: Section; label: string; sub: string }> = [
    { id: "normal", label: "Normal", sub: "Regular articles" },
    { id: "special", label: "Special", sub: "Specials only" },
  ];
  return (
    <div className="auto-seg auto-seg--picker" role="radiogroup" aria-label="Section" data-active={value} data-testid={testId}>
      <span className="auto-seg__indicator" aria-hidden="true" />
      {opts.map((o) => (
        <label key={o.id} className={`auto-seg__pill${value === o.id ? " is-active" : ""}`} data-testid={testId ? `${testId}-${o.id}` : undefined}>
          <input className="auto-seg__radio" type="radio" name={name} value={o.id} checked={value === o.id} disabled={disabled} onChange={() => onChange(o.id)} />
          <span className="auto-seg__label">{o.label}</span>
          <span className="auto-seg__sub">{o.sub}</span>
        </label>
      ))}
    </div>
  );
}

export function SectionTag({ section }: { section: Section }) {
  return <span className={`auto-tag auto-tag--${section}`} data-testid="section-tag">{section === "special" ? "Special" : "Normal"}</span>;
}

export const SPECIAL_SECTION_NOTE = "This profile will only write special articles. It cannot submit normal articles; normal automation runs using its key are refused.";

type ProfileLite = { id: string; name: string; authors: string[] };

/** Client-side mirror of src/lib/author-name.ts (server re-checks everything). */
export function authorError(value: string, others: ProfileLite[]): string | null {
  const r = checkAuthorName(value);
  if (!r.ok) return r.error;
  const taken = r.value ? others.find((o) => o.authors.some((a) => sameAuthor(a, r.value))) : undefined;
  return taken ? `“${taken.name}” already uses this author name.` : null;
}

export const lines = (value: string) => value.split("\n").map((v) => v.trim()).filter(Boolean);
const checkRow = { display: "flex", alignItems: "center", gap: "0.5rem" } as const;

/** Create a profile (name, first author, connection method, Section). Shows the new secret once. */
export function NewProfileForm({ profiles, defaultSection, onCreated }: { profiles: ProfileLite[]; defaultSection: Section; onCreated: (profileId: string, section: Section) => Promise<unknown> | void }) {
  const [name, setName] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [connect, setConnect] = useState<"api-key" | "oauth">("api-key");
  const [redirects, setRedirects] = useState("");
  const [section, setSection] = useState<Section>(defaultSection);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<{ kind: "token"; token: string } | { kind: "oauth"; clientId: string; clientSecret: string; redirectUris: string[] } | null>(null);
  const id = `np-${defaultSection}`;
  const authorProblem = authorError(authorName, profiles);
  return (
    <div className="stack" style={{ marginTop: "0.75rem" }} data-testid={`new-profile-${defaultSection}`}>
      {error ? <p className="banner banner--bad" role="alert">{error}</p> : null}
      {shown?.kind === "token" ? (
        <div className="banner" role="status" data-testid="new-token">
          <p style={{ margin: 0 }}>New API key, shown <strong>once</strong>. Copy it into the AI app as a bearer token, or paste it on the connector approval page. Only a fingerprint is stored.</p>
          <code style={{ display: "block", wordBreak: "break-all", margin: "0.5rem 0" }}>{shown.token}</code>
          <button type="button" className="btn btn--ghost" onClick={() => void navigator.clipboard?.writeText(shown.token)}>Copy</button>{" "}
          <button type="button" className="btn btn--ghost" onClick={() => setShown(null)}>I've saved it</button>
        </div>
      ) : null}
      {shown?.kind === "oauth" ? (
        <div className="banner" role="status" data-testid="new-oauth">
          <p style={{ margin: 0 }}>OAuth client secret, shown <strong>once</strong>. In the AI app, set the MCP server URL to this site's <code>/mcp</code>, then paste the client ID and secret. Only a hash of the secret is stored.</p>
          <p style={{ margin: "0.5rem 0 0" }}>Client ID</p>
          <code style={{ display: "block", wordBreak: "break-all", margin: "0.25rem 0 0.5rem" }}>{shown.clientId}</code>
          <button type="button" className="btn btn--ghost" onClick={() => void navigator.clipboard?.writeText(shown.clientId)}>Copy client ID</button>
          <p style={{ margin: "0.75rem 0 0" }}>Client secret</p>
          <code style={{ display: "block", wordBreak: "break-all", margin: "0.25rem 0 0.5rem" }}>{shown.clientSecret}</code>
          <button type="button" className="btn btn--ghost" onClick={() => void navigator.clipboard?.writeText(shown.clientSecret)}>Copy secret</button>{" "}
          <button type="button" className="btn btn--ghost" onClick={() => setShown(null)}>I've saved it</button>
          <p className="desk-note" style={{ marginBottom: 0 }}>Saved redirect {shown.redirectUris.length === 1 ? "URL" : "URLs"}: {shown.redirectUris.join(", ")}</p>
        </div>
      ) : null}
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const uris = lines(redirects);
          if (connect === "oauth" && uris.length < 1) {
            setError("Paste the redirect URL from the AI app before creating an OAuth profile.");
            return;
          }
          setBusy(true);
          setError(null);
          void (async () => {
            const r = await adminProfileAction({ data: connect === "oauth" ? { action: "create", name, connect, redirectUris: uris, authorName, section } : { action: "create", name, connect: "api-key", authorName, section } });
            setName("");
            setAuthorName("");
            setRedirects("");
            if ("token" in r && r.token) setShown({ kind: "token", token: r.token });
            if ("oauth" in r && r.oauth) setShown({ kind: "oauth", clientId: r.oauth.clientId, clientSecret: r.oauth.clientSecret, redirectUris: r.oauth.redirectUris });
            if ("profile" in r && r.profile) await onCreated(r.profile.id, section);
            setSection(defaultSection);
          })()
            .catch((caught: unknown) => setError(errorText(caught)))
            .finally(() => setBusy(false));
        }}
      >
        <label className="field"><span>New profile name</span><input value={name} maxLength={60} placeholder={defaultSection === "special" ? "Claude weekly deep dives" : "Gemini daily tech"} onChange={(e) => setName(e.target.value)} data-testid="new-profile-name" /></label>
        <fieldset className="field">
          <legend>Section (required)</legend>
          <SectionPicker value={section} onChange={setSection} name={`${id}-section`} testId={`${id}-section`} />
          {section === "special" ? <p className="desk-note auto-seg__note" role="note" data-testid="special-section-note">{SPECIAL_SECTION_NOTE}</p> : null}
        </fieldset>
        <label className="field"><span>First author name (optional; add more in the profile&apos;s Authors card)</span><input value={authorName} maxLength={60} placeholder="John Daniel" data-testid="new-profile-author" onChange={(e) => setAuthorName(e.target.value)} />
          {authorProblem ? <small className="author-cell__error" role="alert">{authorProblem}</small> : null}
        </label>
        <fieldset className="field">
          <legend>How should this AI app connect?</legend>
          <label style={checkRow}><input style={{ width: "auto" }} type="radio" name={`${id}-connect`} checked={connect === "api-key"} onChange={() => setConnect("api-key")} /> API key (bearer token)</label>
          <label style={checkRow}><input style={{ width: "auto" }} type="radio" name={`${id}-connect`} checked={connect === "oauth"} onChange={() => setConnect("oauth")} /> OAuth client ID and secret</label>
        </fieldset>
        {connect === "oauth" ? (
          <label className="field"><span>Redirect URL from the AI app (one per line)</span>
            <textarea value={redirects} onChange={(e) => setRedirects(e.target.value)} placeholder="Paste the redirect URL from the AI app" />
          </label>
        ) : <p className="desk-note">An API key is created with the profile and shown once. You can add an OAuth client later from the same row.</p>}
        <button className="btn" type="submit" disabled={busy || name.trim().length < 2 || Boolean(authorProblem)} data-testid="add-profile">Add {section === "special" ? "special" : "normal"} profile</button>
      </form>
    </div>
  );
}
