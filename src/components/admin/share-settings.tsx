import { useRef, useState } from "react";
import { SHARE_KIND_NAMES, shareCopyText, shareHrefFor, nativeShareData, type ShareSettings, type ShareKind } from "@/lib/share-buttons";
import {
  SHARE_PLACEHOLDERS,
  composeShare,
  defaultNetworkOverride,
  isDefaultOverride,
  joinShare,
  logoPlacement,
  parseHashtags,
  shareConfigProblems,
  type LogoPosition,
  type ShareConfig,
  type ShareNetworkOverride,
  type ShareSubject,
  type Toggle3,
} from "@/lib/share-config";
import { FORMAT_TAGS, NETWORK_DEFAULT_FORMAT, NETWORK_LIMITS, SHARE_FORMATS, SHARE_FORMAT_NAMES, SHARE_FORMAT_SUPPORT, formattingProblems, type ShareFormat } from "@/lib/share-format";

type Media = { id: string; filename: string };
const NETWORKS: Exclude<ShareKind, "custom">[] = ["whatsapp", "telegram", "x", "facebook", "linkedin", "threads", "bluesky", "reddit", "pinterest", "hackernews", "email", "copy", "native"];
const ALL_NETWORKS: ShareKind[] = [...NETWORKS, "custom"];
const POSITIONS: { value: LogoPosition; label: string }[] = [
  { value: "top-left", label: "Top left" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-right", label: "Bottom right" },
  { value: "center", label: "Centre" },
];

/** Formatting legend + quick-insert buttons for one text field. */
function TagBar({ target, value, onChange }: { target: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>; value: string; onChange: (v: string) => void }) {
  const insert = (open: string, close: string) => {
    const el = target.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + open + value.slice(start, end) + close + value.slice(end));
    requestAnimationFrame(() => el?.focus());
  };
  return (
    <div className="inline-actions share-tagbar" role="toolbar" aria-label="Formatting">
      {FORMAT_TAGS.map((t) => (
        <button key={t.tag} type="button" className="btn btn--ghost btn--sm" title={`${t.label}: ${t.example}`} onClick={() => (t.wraps ? insert(`<${t.tag}>`, `</${t.tag}>`) : insert(`<${t.tag}>`, ""))}>
          <code>{t.wraps ? `<${t.tag}>` : `<${t.tag}>`}</code> {t.label}
        </button>
      ))}
    </div>
  );
}

function Problems({ text }: { text: string }) {
  const list = formattingProblems(text);
  return list.length ? <p className="field-help field-help--bad" role="alert">{list.join(" ")}</p> : null;
}

function TemplateField({ label, value, onChange, rows = 2, help, testId }: { label: string; value: string; onChange: (v: string) => void; rows?: number; help?: string; testId?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <label className="field">
      <span>{label}</span>
      <TagBar target={ref} value={value} onChange={onChange} />
      <textarea ref={ref} rows={rows} value={value} data-testid={testId} onChange={(e) => onChange(e.target.value)} />
      {help ? <span className="field-help">{help}</span> : null}
      <Problems text={value} />
    </label>
  );
}

const TOGGLE_LABEL: Record<Toggle3, string> = { inherit: "Same as main", on: "On", off: "Off" };
function Toggle({ label, value, onChange }: { label: string; value: Toggle3; onChange: (v: Toggle3) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as Toggle3)}>
        {(["inherit", "on", "off"] as const).map((v) => <option key={v} value={v}>{TOGGLE_LABEL[v]}</option>)}
      </select>
    </label>
  );
}

/**
 * t195–t197: Admin → Settings → Sharing. Everything a share of an article carries
 * (text, link, hashtags, extra links, image, link-card meta) for every article,
 * Normal and Special. Saved with the site settings; the public site reads it on
 * every render, so a save applies to the whole share pipeline at once.
 */
export function ShareSettingsEditor({ value, onChange, media, siteName, publisher, siteLogoMediaId, defaultOgMediaId, sample }: {
  value: ShareSettings;
  onChange: (next: ShareSettings) => void;
  media: Media[];
  siteName: string;
  publisher: string;
  siteLogoMediaId: string | null;
  defaultOgMediaId: string | null;
  sample: { title: string; slug: string } | null;
}) {
  const cfg: ShareConfig = value;
  const set = (patch: Partial<ShareConfig>) => onChange({ ...value, ...patch });
  const msg = (patch: Partial<ShareConfig["message"]>) => set({ message: { ...cfg.message, ...patch } });
  const [network, setNetwork] = useState<ShareKind>("whatsapp");
  const [editing, setEditing] = useState<ShareKind>("whatsapp");
  const [tagsText, setTagsText] = useState(cfg.message.hashtags.map((t) => `#${t}`).join(" "));
  const override = cfg.networks[editing] ?? defaultNetworkOverride();
  const setOverride = (patch: Partial<ShareNetworkOverride>) => {
    const next = { ...override, ...patch };
    const networks = { ...cfg.networks };
    if (isDefaultOverride(next)) delete networks[editing];
    else networks[editing] = next;
    set({ networks });
  };
  const problems = shareConfigProblems(cfg);
  const subject: ShareSubject = {
    title: sample?.title ?? "Example article title",
    slug: sample?.slug ?? "example-article",
    path: `/articles/${sample?.slug ?? "example-article"}`,
    excerpt: "A one-line summary of the article.",
    author: publisher,
    category: "Tech",
  };
  const ctx = { canonicalUrl: `https://blog.dypol.workers.dev${subject.path}`, siteName, publisher };
  const composed = composeShare(cfg, subject, network, ctx);
  const previewText = network === "copy" ? shareCopyText(cfg, subject, ctx) : network === "native" ? (() => { const d = nativeShareData(cfg, subject, ctx); return [d.text ?? d.title, d.url].join("\n"); })() : joinShare(composed);
  const previewHref = network === "copy" || network === "native" ? null : shareHrefFor({ kind: network, template: network === "custom" ? "https://example.com/share?text={text}&url={url}" : "" }, cfg, subject, ctx);
  const logoId = cfg.image.logo === "custom" ? cfg.image.logoMediaId : siteLogoMediaId;
  const baseId = defaultOgMediaId ?? media[0]?.id ?? null;
  const place = logoPlacement(cfg.image, { width: 4, height: 1 });
  return (
    <fieldset className="block-card" data-testid="share-settings" id="sharing">
      <legend>Sharing</legend>
      <p className="field-help">
        What is shared when a visitor shares any article (Normal and Special) from the share buttons, Copy link or the device Share menu, and the
        link card (title, description, image) every app shows for the link. Saving applies it everywhere at once. Which buttons appear is set in
        Homepage builder → Article sidebar → Share buttons.
      </p>

      <h3 className="adm-group__label">Share text</h3>
      <TemplateField label="Main text" testId="share-template" value={cfg.message.template} rows={3} onChange={(template) => msg({ template })}
        help={`Placeholders: ${SHARE_PLACEHOLDERS.map((p) => `{${p.key}} = ${p.help}`).join(" · ")}`} />
      <div className="share-legend" data-testid="share-legend">
        <p className="field-help"><strong>Formatting tags</strong> (our shorthand; each app gets its own real formatting, or plain text where it has none):</p>
        <ul className="field-help">
          {FORMAT_TAGS.map((t) => <li key={t.tag}><code>{t.example}</code> = {t.label}</li>)}
        </ul>
        <p className="field-help">Links, #hashtags and @handles are never styled, so they keep working.</p>
      </div>
      <TemplateField label="Text before (optional)" value={cfg.message.prefix} onChange={(prefix) => msg({ prefix })} />
      <TemplateField label="Text after (optional)" value={cfg.message.suffix} onChange={(suffix) => msg({ suffix })} />
      <label className="field">
        <span>Hashtags (added at the end)</span>
        <input value={tagsText} placeholder="#tech #news" data-testid="share-hashtags" onChange={(e) => { setTagsText(e.target.value); msg({ hashtags: parseHashtags(e.target.value) }); }} />
        <span className="field-help">Up to 10. Letters, numbers and _ only.</span>
      </label>
      <label className="field">
        <span>Between the parts</span>
        <select value={cfg.message.separator} onChange={(e) => msg({ separator: e.target.value as ShareConfig["message"]["separator"] })}>
          <option value="space">Space</option>
          <option value="newline">New line</option>
          <option value="blank">Blank line</option>
        </select>
      </label>
      <label className="check-row"><input type="checkbox" checked={cfg.message.includeLink} onChange={(e) => msg({ includeLink: e.target.checked })} />Add the article link to the text where an app takes text only (WhatsApp, Threads, Bluesky, X, email, share menu)</label>
      <p className="field-help">Facebook, LinkedIn, Telegram, Reddit, Pinterest and Hacker News always get the link.</p>

      <h3 className="adm-group__label">Extra links</h3>
      {cfg.message.extraLinks.map((x, i) => (
        <div key={i} className="filters" data-testid="share-extra-link">
          <label className="field"><span>Label</span><input value={x.label} placeholder="Newsletter" onChange={(e) => msg({ extraLinks: cfg.message.extraLinks.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)) })} /></label>
          <label className="field" style={{ flex: 1 }}><span>URL</span><input value={x.url} placeholder="https://…" onChange={(e) => msg({ extraLinks: cfg.message.extraLinks.map((y, j) => (j === i ? { ...y, url: e.target.value } : y)) })} /></label>
          <button type="button" className="btn btn--ghost" onClick={() => msg({ extraLinks: cfg.message.extraLinks.filter((_, j) => j !== i) })}>Remove</button>
        </div>
      ))}
      {cfg.message.extraLinks.length < 5 ? <button type="button" className="btn btn--ghost" onClick={() => msg({ extraLinks: [...cfg.message.extraLinks, { label: "", url: "" }] })}>Add extra link</button> : null}

      <h3 className="adm-group__label">Link</h3>
      <label className="check-row"><input type="checkbox" checked={cfg.link.utm.enabled} onChange={(e) => set({ link: { ...cfg.link, utm: { ...cfg.link.utm, enabled: e.target.checked } } })} />Add UTM tags to shared links (the page's canonical URL never changes)</label>
      {cfg.link.utm.enabled ? (
        <div className="filters">
          {(["source", "medium", "campaign", "content"] as const).map((k) => (
            <label key={k} className="field"><span>utm_{k}</span><input value={cfg.link.utm[k]} onChange={(e) => set({ link: { ...cfg.link, utm: { ...cfg.link.utm, [k]: e.target.value } } })} /></label>
          ))}
          <p className="field-help">{"{network}"} = the app (whatsapp, x…), {"{slug}"} = the article slug.</p>
        </div>
      ) : null}
      <label className="field">
        <span>Copy link copies</span>
        <select value={cfg.link.copyMode} onChange={(e) => set({ link: { ...cfg.link, copyMode: e.target.value as "link" | "text" } })}>
          <option value="link">Only the link</option>
          <option value="text">The share text and the link</option>
        </select>
      </label>

      <h3 className="adm-group__label">Per app</h3>
      <label className="field">
        <span>App</span>
        <select value={editing} data-testid="share-network-edit" onChange={(e) => setEditing(e.target.value as ShareKind)}>
          {ALL_NETWORKS.map((n) => <option key={n} value={n}>{SHARE_KIND_NAMES[n]}{cfg.networks[n] ? " (customised)" : ""}</option>)}
        </select>
      </label>
      <p className="field-help">{NETWORK_LIMITS[editing]}</p>
      <TemplateField label={`${SHARE_KIND_NAMES[editing]} text (empty = main text)`} value={override.template} onChange={(template) => setOverride({ template })} />
      <div className="filters">
        <Toggle label="Link in text" value={override.includeLink} onChange={(includeLink) => setOverride({ includeLink })} />
        <Toggle label="Hashtags" value={override.hashtags} onChange={(hashtags) => setOverride({ hashtags })} />
        <Toggle label="Extra links" value={override.extraLinks} onChange={(extraLinks) => setOverride({ extraLinks })} />
        <Toggle label="UTM tags" value={override.utm} onChange={(utm) => setOverride({ utm })} />
        <label className="field"><span>utm_source</span><input value={override.utmSource} placeholder={cfg.link.utm.source} onChange={(e) => setOverride({ utmSource: e.target.value })} /></label>
      </div>
      <label className="field">
        <span>Formatting sent to {SHARE_KIND_NAMES[editing]}</span>
        <select value={override.format} data-testid="share-format" onChange={(e) => setOverride({ format: e.target.value as ShareNetworkOverride["format"] })}>
          <option value="inherit">Recommended: {SHARE_FORMAT_NAMES[NETWORK_DEFAULT_FORMAT[editing] ?? "plain"]}</option>
          {SHARE_FORMATS.map((f) => <option key={f} value={f}>{SHARE_FORMAT_NAMES[f]}</option>)}
        </select>
        <span className="field-help">{SHARE_FORMAT_SUPPORT[(override.format === "inherit" ? NETWORK_DEFAULT_FORMAT[editing] ?? "plain" : override.format) as ShareFormat]}</span>
      </label>
      {override !== defaultNetworkOverride() && cfg.networks[editing] ? <button type="button" className="btn btn--ghost" onClick={() => { const networks = { ...cfg.networks }; delete networks[editing]; set({ networks }); }}>Reset {SHARE_KIND_NAMES[editing]} to main settings</button> : null}

      <h3 className="adm-group__label">Preview image</h3>
      <label className="field">
        <span>Image shown in link cards</span>
        <select value={cfg.image.source} data-testid="share-image-source" onChange={(e) => set({ image: { ...cfg.image, source: e.target.value as ShareConfig["image"]["source"] } })}>
          <option value="cover">Article cover (default social image when none)</option>
          <option value="default">Always the default social image</option>
          <option value="branded">Article cover with your logo on it</option>
        </select>
      </label>
      {cfg.image.source === "branded" ? (
        <>
          <div className="filters">
            <label className="field"><span>Logo</span>
              <select value={cfg.image.logo === "custom" ? (cfg.image.logoMediaId ?? "") : ""} onChange={(e) => set({ image: { ...cfg.image, logo: e.target.value ? "custom" : "site", logoMediaId: e.target.value || null } })}>
                <option value="">Site logo{siteLogoMediaId ? "" : " (none set)"}</option>
                {media.map((m) => <option key={m.id} value={m.id}>{m.filename}</option>)}
              </select>
            </label>
            <label className="field"><span>Position</span>
              <select value={cfg.image.position} onChange={(e) => set({ image: { ...cfg.image, position: e.target.value as LogoPosition } })}>
                {POSITIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </label>
            <label className="field"><span>Size (% of width)</span><input type="number" min={5} max={50} value={cfg.image.size} onChange={(e) => set({ image: { ...cfg.image, size: Math.max(5, Math.min(50, Number(e.target.value) || 18)) } })} /></label>
            <label className="field"><span>Margin (px)</span><input type="number" min={0} max={120} value={cfg.image.margin} onChange={(e) => set({ image: { ...cfg.image, margin: Math.max(0, Math.min(120, Number(e.target.value) || 0)) } })} /></label>
            <label className="field"><span>Opacity (%)</span><input type="number" min={10} max={100} value={cfg.image.opacity} onChange={(e) => set({ image: { ...cfg.image, opacity: Math.max(10, Math.min(100, Number(e.target.value) || 100)) } })} /></label>
          </div>
          {!logoId ? <p className="field-help field-help--bad">No logo: set a site logo below or pick one here. Until then the plain image is used.</p> : null}
          <div className="share-image-preview" data-testid="share-image-preview" style={{ position: "relative", width: "100%", maxWidth: 480, aspectRatio: "1200 / 630", background: "#ddd", overflow: "hidden", borderRadius: 8 }}>
            {baseId ? <img src={`/media/${baseId}`} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
            {logoId ? <img src={`/media/${logoId}`} alt="Logo position" style={{ position: "absolute", left: `${(place.left / 1200) * 100}%`, top: cfg.image.position.startsWith("top") ? `${(cfg.image.margin / 630) * 100}%` : cfg.image.position === "center" ? "50%" : undefined, bottom: cfg.image.position.startsWith("bottom") ? `${(cfg.image.margin / 630) * 100}%` : undefined, transform: cfg.image.position === "center" ? "translateY(-50%)" : undefined, width: `${cfg.image.size}%`, opacity: cfg.image.opacity / 100 }} /> : null}
          </div>
          <p className="field-help">The image is made once per article at 1200×630 and stored; changing logo or placement makes new images.</p>
        </>
      ) : null}

      <h3 className="adm-group__label">Link card (what apps show for the link)</h3>
      <label className="field"><span>Card title (empty = page title)</span><input value={cfg.meta.titleTemplate} placeholder="{title} | {site}" onChange={(e) => set({ meta: { ...cfg.meta, titleTemplate: e.target.value } })} /></label>
      <label className="field"><span>Card description (empty = SEO description / summary)</span><input value={cfg.meta.descriptionTemplate} placeholder="{description}" onChange={(e) => set({ meta: { ...cfg.meta, descriptionTemplate: e.target.value } })} /></label>
      <p className="field-help">Link cards cannot show bold or italic; tags here are removed.</p>
      <div className="filters">
        <label className="field"><span>Site name on cards (empty = {siteName})</span><input value={cfg.meta.siteName} onChange={(e) => set({ meta: { ...cfg.meta, siteName: e.target.value } })} /></label>
        <label className="field"><span>X account (@handle)</span><input value={cfg.meta.twitterSite} placeholder="@yourhandle" onChange={(e) => set({ meta: { ...cfg.meta, twitterSite: e.target.value } })} /></label>
        <label className="field"><span>X card</span>
          <select value={cfg.meta.twitterCard} onChange={(e) => set({ meta: { ...cfg.meta, twitterCard: e.target.value as ShareConfig["meta"]["twitterCard"] } })}>
            <option value="auto">Automatic (large image when there is one)</option>
            <option value="summary_large_image">Large image</option>
            <option value="summary">Small image</option>
          </select>
        </label>
      </div>
      <label className="check-row"><input type="checkbox" checked={cfg.meta.imageAlt} onChange={(e) => set({ meta: { ...cfg.meta, imageAlt: e.target.checked } })} />Image description (alt text)</label>
      <label className="check-row"><input type="checkbox" checked={cfg.meta.articleTimes} onChange={(e) => set({ meta: { ...cfg.meta, articleTimes: e.target.checked } })} />Published / updated times</label>
      <label className="check-row"><input type="checkbox" checked={cfg.meta.section} onChange={(e) => set({ meta: { ...cfg.meta, section: e.target.checked } })} />Topic (article:section)</label>

      <h3 className="adm-group__label">Preview</h3>
      <label className="field">
        <span>Preview for</span>
        <select value={network} data-testid="share-preview-network" onChange={(e) => setNetwork(e.target.value as ShareKind)}>
          {ALL_NETWORKS.map((n) => <option key={n} value={n}>{SHARE_KIND_NAMES[n]}</option>)}
        </select>
      </label>
      <p className="field-help">{NETWORK_LIMITS[network]} Formatting: {SHARE_FORMAT_NAMES[composed.format]}.</p>
      <pre className="share-preview" data-testid="share-preview" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{network === "facebook" || network === "linkedin" ? `(no text — link only)\n${composed.link}` : previewText}</pre>
      {previewHref ? <p className="field-help" data-testid="share-preview-href" style={{ wordBreak: "break-all" }}>Opens: {previewHref}</p> : null}
      <p className="field-help">Example article: {subject.title}</p>
      {problems.length ? <ul className="banner banner--bad" role="alert" data-testid="share-problems">{problems.map((p) => <li key={p.path + p.message}>{p.message}</li>)}</ul> : null}
    </fieldset>
  );
}
