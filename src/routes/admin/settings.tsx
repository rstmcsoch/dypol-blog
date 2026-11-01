import { createFileRoute } from "@tanstack/react-router";
import { adminPending } from "@/components/admin/pending";
import { FormShell, useSiteForm } from "@/components/admin/site-form";
import { adminSettings } from "@/content/admin-api";
import { useMemo } from "react";
import { checkHeadCode } from "@/lib/ads/head-html";
import { isRootSocialUrl, SOCIAL_LABELS, SOCIAL_PLATFORMS, type SocialLink } from "@/lib/social-links";

export const Route = createFileRoute("/admin/settings")({
  ...adminPending,
  loader: () => adminSettings(),
  component: SettingsAdmin,
});

function SettingsAdmin() {
  const data = Route.useLoaderData();
  const form = useSiteForm(data.site);
  const { site, patch } = form;
  return (
    <>
      <FormShell kicker="System" title="Settings" intro="Your site's name, description and logo. Menu, footer and other wording are under Site text." form={form}>
        {data.mediaNotice ? (
          <p className="banner banner--bad" role="alert">
            {data.mediaNotice}
          </p>
        ) : null}
        <fieldset className="block-card">
          <legend>Site identity</legend>
          <label className="field">
            <span>Website name</span>
            <input value={site.name} onChange={(e) => patch({ name: e.target.value })} required />
          </label>
          <label className="field">
            <span>Browser tab title</span>
            <input value={site.title} onChange={(e) => patch({ title: e.target.value })} required />
          </label>
          <label className="field">
            <span>Description (search engines and footer)</span>
            <textarea value={site.description} onChange={(e) => patch({ description: e.target.value })} required />
          </label>
          <label className="field">
            <span>Publisher name</span>
            <input value={site.publisher} onChange={(e) => patch({ publisher: e.target.value })} required />
          </label>
        </fieldset>
        <fieldset className="block-card">
          <legend>Analytics and consent</legend>
          <label className="check-row"><input type="checkbox" checked={site.analytics.enabled} onChange={(e) => patch({ analytics: { ...site.analytics, enabled: e.target.checked } })} />Enable Google Analytics (requires visitor consent)</label>
          <label className="field"><span>GA4 Measurement ID</span><input value={site.analytics.measurementId} placeholder="G-…" onChange={(e) => patch({ analytics: { ...site.analytics, measurementId: e.target.value } })} /></label>
          <p className="field-help">No Google script or request is sent before Accept. Admin pages never load Google Analytics.</p>
        </fieldset>
        <HeadCodeField value={site.customHead} onChange={(customHead) => patch({ customHead })} />
        <fieldset className="block-card">
          <legend>Social links</legend>
          <p className="field-help">
            Shown as icons under the logo and description in the footer. Leave a URL empty (or untick Show) and
            that icon stays hidden. Use full https:// addresses; Email takes a mailto: address, RSS takes /feed.xml.
          </p>
          {SOCIAL_PLATFORMS.map((platform) => {
            const current: SocialLink = site.socials.find((s) => s.platform === platform) ?? { platform, url: "", visible: true };
            const update = (next: Partial<SocialLink>) => {
              const others = site.socials.filter((s) => s.platform !== platform);
              patch({ socials: [...others, { ...current, ...next }] });
            };
            return (
              <div key={platform} className="filters">
                <label className="field" style={{ flex: 1 }}>
                  <span>{SOCIAL_LABELS[platform]}</span>
                  <input
                    value={current.url}
                    placeholder={platform === "email" ? "mailto:hello@example.com" : platform === "rss" ? "/feed.xml" : "https://…"}
                    onChange={(e) => update({ url: e.target.value })}
                  />
                  {isRootSocialUrl(platform, current.url) ? <span className="field-help" role="status">This is a platform homepage, not a profile. It will remain hidden until you enter your account URL.</span> : null}
                </label>
                <label className="field">
                  <span>Show</span>
                  <input type="checkbox" checked={current.visible} onChange={(e) => update({ visible: e.target.checked })} />
                </label>
              </div>
            );
          })}
        </fieldset>
        <fieldset className="block-card">
          <legend>AI publishing limit</legend>
          <label className="field">
            <span>Maximum AI-published articles per day (whole website)</span>
            <input
              type="number"
              min={0}
              max={100}
              value={site.aiDailyPublishLimit}
              onChange={(e) => patch({ aiDailyPublishLimit: Math.max(0, Math.min(100, Math.floor(Number(e.target.value) || 0))) })}
            />
          </label>
          <p className="field-help">
            Counts every article published by AI automation (automatic and explicit MCP publishes, all automation
            profiles together) per calendar day (UTC). When the limit is reached, AI publishing stops until the next
            day; drafts are unaffected. Publishing manually here in the admin panel is never counted or blocked.
            Set 0 for no limit.
          </p>
        </fieldset>
        <fieldset className="block-card">
          <legend>Logo & icon</legend>
          <label className="field">
            <span>Logo</span>
            <select value={site.logoMediaId ?? ""} onChange={(e) => patch({ logoMediaId: e.target.value || null })}>
              <option value="">Text logo only</option>
              {data.media.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.filename}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Browser icon (favicon)</span>
            <select value={site.faviconMediaId ?? ""} onChange={(e) => patch({ faviconMediaId: e.target.value || null })}>
              <option value="">Default icon</option>
              {data.media.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.filename}
                </option>
              ))}
            </select>
          </label>
          <label className="field"><span>Default social-sharing image</span>
            <select value={site.defaultOgMediaId ?? ""} onChange={(e) => patch({ defaultOgMediaId: e.target.value || null })}>
              <option value="">Built-in share image</option>
              {data.media.map((item) => <option key={item.id} value={item.id}>{item.filename}</option>)}
            </select>
          </label>
          <p className="field-help">Upload images under Media first.</p>
        </fieldset>
      </FormShell>
      <section className="desk-section block-card">
        <h2>Access</h2>
        <p className="desk-note">
          You sign in with the admin token stored as the <code>ADMIN_TOKEN</code> secret on the Cloudflare Worker. Changing that secret (or{" "}
          <code>ADMIN_SESSION_SECRET</code>) signs everyone out. See Help for details.
        </p>
      </section>
    </>
  );
}

/** t164: Settings → Custom head code (server-placed in <head> on every public page). */
function HeadCodeField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const check = useMemo(() => checkHeadCode(value), [value]);
  return (
    <fieldset className="block-card head-code" id="custom-head-code">
      <legend>Custom head code</legend>
      <p className="field-help">
        Paste verification tags (Google Search Console, Bing, Pinterest, Yandex), analytics or tag-manager scripts, link or style tags. The server places them inside
        &lt;head&gt; on every public page right after the consent tool’s code, whether ads are on or off. Admin, API, MCP and sign-in pages never get them. Changes go live as
        soon as you save, with no deploy.
      </p>
      <label className="field">
        <span>Head code</span>
        <textarea
          rows={7}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={'<meta name="google-site-verification" content="…" />'}
        />
      </label>
      <div className="head-code__preview" aria-live="polite">
        <p className="head-code__count">
          {check.tags.length ? `${check.tags.length} tag${check.tags.length === 1 ? "" : "s"} will be placed in <head>:` : "No tags yet."}
        </p>
        {check.tags.length ? (
          <ol className="head-code__list">
            {check.tags.map((t, i) => (
              <li key={i}>
                <code className="head-code__tag">{t.tag}</code>
                <span className="head-code__sum">{t.summary}</span>
              </li>
            ))}
          </ol>
        ) : null}
        {check.dropped.length ? (
          <div className="banner banner--bad head-code__dropped" role="alert">
            <strong>Removed when you save</strong> (only meta, link, script, style and noscript belong in &lt;head&gt;; &lt;base&gt; is not allowed):
            <ul>{check.dropped.map((d, i) => <li key={i}><code>{d}</code></li>)}</ul>
          </div>
        ) : null}
      </div>
      <p className="field-help">
        Ad-network code (AdSense Auto ads, Adsterra Popunder / Social Bar) stays under <a href="/admin/ads">Ads → Scripts &amp; ads.txt</a>, and the certified consent tool under{" "}
        <a href="/admin/ads">Ads → Settings</a>; that code obeys the ads switch and consent rules.
      </p>
    </fieldset>
  );
}
