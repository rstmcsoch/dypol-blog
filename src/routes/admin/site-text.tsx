import "@/styles-site-admin.css";
import { FooterEditor } from "@/components/admin/footer-editor";
import { SettingsTabs, type SettingsTab } from "@/components/admin/settings-tabs";
import { tabFromPanelId, tabPanelProps } from "@/lib/admin-tabs";
import { useState } from "react";
import { adminPending } from "@/components/admin/pending";
import { createFileRoute } from "@tanstack/react-router";
import { FormShell, move, useSiteForm } from "@/components/admin/site-form";
import { getShell } from "@/content/public-api";
import { adminSettings, adminTaxonomy } from "@/content/admin-api";
import { site as defaults } from "@/content/site";
import type { NavHref, SiteConfig } from "@/content/types";

export const Route = createFileRoute("/admin/site-text")({
  ...adminPending,
  loader: async () => {
    const [settings, taxonomy, shell] = await Promise.all([adminSettings(), adminTaxonomy(), getShell()]);
    return { ...settings, pages: shell.pages, categories: taxonomy.categories.map((c) => ({ slug: c.slug, label: c.label })) };
  },
  component: SiteTextAdmin,
});

type LabelKey = keyof SiteConfig["labels"];

const P = "sitetext";
const SITE_TEXT_TABS: SettingsTab[] = [
  { id: "menu", label: "Main menu" },
  { id: "footer", label: "Footer" },
  { id: "labels", label: "Interface labels" },
  { id: "consent", label: "Consent & About" },
];

/** Plain-language names for every piece of interface text, grouped by where it appears. */
const groups: { title: string; items: [LabelKey, string][] }[] = [
  {
    title: "Homepage",
    items: [
      ["featured", "Featured section heading"],
      ["also", "“Also filed” band heading"],
      ["latest", "Latest list heading"],
      ["fullIndex", "Link to all articles"],
      ["topics", "Topics section heading"],
      ["popular", "“Most read” heading"],
      ["topicRows", "Topic rows label"],
      ["moreIn", "Topic row button (“More in …”)"],
      ["quickReads", "Quick reads heading"],
      ["moreStories", "More stories heading"],
      ["read", "Read button"],
    ],
  },
  {
    title: "Article page",
    items: [
      ["related", "Heading of the related list under the article"],
      ["alsoLike", "Sidebar: related articles heading"],
      ["newStories", "Sidebar: newest articles heading"],
      ["tags", "Sidebar: tags heading"],
      ["share", "Sidebar: share heading"],
      ["copyLink", "Copy link button"],
      ["linkCopied", "Text after the link is copied"],
      ["neighbors", "Next/previous navigation (screen readers)"],
      ["newer", "Newer article label"],
      ["older", "Older article label"],
      ["minRead", "Reading time unit (e.g. “min”)"],
    ],
  },
  {
    title: "All articles & topics pages",
    items: [
      ["indexKicker", "All articles: small heading"],
      ["indexTitle", "All articles: page title"],
      ["indexLede", "All articles: intro"],
      ["topicsKicker", "Topics: small heading"],
      ["topicsTitle", "Topics: page title"],
      ["topicsLede", "Topics: intro"],
      ["emptyTitle", "Empty topic: title"],
      ["emptyBody", "Empty topic: text"],
      ["emptyAction", "Empty topic: button"],
    ],
  },
  {
    title: "About page",
    items: [
      ["aboutKicker", "About: small heading"],
      ["aboutTitle", "About: page title"],
    ],
  },
  {
    title: "Header, menu & theme switch",
    items: [
      ["menu", "Menu button"],
      ["close", "Close menu button"],
      ["menuTopics", "Phone menu: topics heading"],
      ["menuAllTopics", "Phone menu: all-topics button"],
      ["day", "Day theme button"],
      ["night", "Night theme button"],
      ["themeGroup", "Theme switch (screen readers)"],
      ["dayTheme", "Day theme description (screen readers)"],
      ["nightTheme", "Night theme description (screen readers)"],
      ["skip", "“Skip to content” link"],
      ["primaryNav", "Main menu name (screen readers)"],
      ["footerNav", "Footer menu name (screen readers)"],
    ],
  },
  {
    title: "Errors & loading",
    items: [
      ["notFoundKicker", "Page not found: small heading"],
      ["notFoundTitle", "Page not found: title"],
      ["notFoundBody", "Page not found: text"],
      ["backHome", "Page not found: button"],
      ["errorTitle", "Error: title"],
      ["errorHome", "Error: button"],
      ["loading", "Loading text"],
    ],
  },
];

function SiteTextAdmin() {
  const data = Route.useLoaderData();
  const form = useSiteForm(data.site);
  const { site, patch } = form;
  const [tab, setTab] = useState<string>("menu");
  const [labelQuery, setLabelQuery] = useState("");
  const setLabel = (key: LabelKey, value: string) => patch({ labels: { ...site.labels, [key]: value } });
  const covered = new Set(groups.flatMap((g) => g.items.map(([k]) => k)));
  const other = (Object.keys(site.labels) as LabelKey[]).filter((k) => !covered.has(k));
  const q = labelQuery.trim().toLowerCase();

  return (
    <FormShell
      kicker="Site"
      title="Site text"
      intro="Every word visitors see outside your articles: menu, footer, headings, buttons, and cookie notice. Empty or reset fields revert to default text."
      form={form}
      onInvalid={(el) => {
        const panel = tabFromPanelId(P, el);
        if (panel) setTab(panel);
      }}
    >
      <SettingsTabs tabs={SITE_TEXT_TABS} active={tab} onChange={setTab} label="Site text sections" idPrefix={P} />

      <div {...tabPanelProps(P, "menu", tab)}>
        <fieldset className="block-card sa-card">
          <legend>Main menu ({site.nav.filter((x) => x.visible).length} visible / {site.nav.length} total)</legend>
          <p className="sa-note">About five visible items reads best. Topic shortcuts link straight to one topic page and only show while that topic has published stories.</p>
          <div className="st-menu-list">
            {site.nav.map((item, index) => (
              <div key={item.id} className="st-menu-row">
                <label className="field">
                  <span>Label for {navTarget(item.href, data.categories)}</span>
                  <input value={item.label} onChange={(e) => patch({ nav: site.nav.map((x, i) => (i === index ? { ...x, label: e.target.value } : x)) })} />
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={item.visible} onChange={(e) => patch({ nav: site.nav.map((x, i) => (i === index ? { ...x, visible: e.target.checked } : x)) })} />
                  Visible
                </label>
                <div className="adm-row-actions">
                  <button type="button" className="btn btn--ghost btn--sm" aria-label={`Move ${item.label} up`} disabled={index === 0} onClick={() => patch({ nav: move(site.nav, index, -1) })}>
                    ↑
                  </button>
                  <button type="button" className="btn btn--ghost btn--sm" aria-label={`Move ${item.label} down`} disabled={index === site.nav.length - 1} onClick={() => patch({ nav: move(site.nav, index, 1) })}>
                    ↓
                  </button>
                  {item.href.startsWith("/topics/") ? (
                    <button type="button" className="btn btn--danger-ghost btn--sm" aria-label={`Remove ${item.label}`} onClick={() => patch({ nav: site.nav.filter((_, i) => i !== index) })}>
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          <AddTopicShortcut
            categories={data.categories.filter((c) => !site.nav.some((item) => item.href === `/topics/${c.slug}`))}
            disabled={site.nav.length >= 8}
            onAdd={(c) => patch({ nav: [...site.nav.filter((item) => item.id !== "about"), { id: `topic-${c.slug}`.slice(0, 40), label: c.label, href: `/topics/${c.slug}`, visible: true }, ...site.nav.filter((item) => item.id === "about")] })}
          />
        </fieldset>
      </div>

      <div {...tabPanelProps(P, "footer", tab)} className="sa-stack">
        <fieldset className="block-card sa-card">
          <legend>Footer bar &amp; quick links</legend>
          <label className="field" style={{ margin: 0 }}>
            <span>Footer line (use {"{year}"} for the current year)</span>
            <input value={site.footer.note} onChange={(e) => patch({ footer: { ...site.footer, note: e.target.value } })} />
          </label>
          <div className="st-subbox">
            <div className="st-subbox__head">
              <p className="st-subbox__title">Footer links ({site.footer.links.length}/8)</p>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={site.footer.links.length >= 8}
                onClick={() => patch({ footer: { ...site.footer, links: [...site.footer.links, { id: `link-${Date.now()}`, label: "New link", href: "/" satisfies NavHref }] } })}
              >
                + Add footer link
              </button>
            </div>
            {site.footer.links.length === 0 ? (
              <p className="field-help" style={{ margin: 0 }}>No quick footer links added.</p>
            ) : (
              site.footer.links.map((link, index) => (
                <div key={link.id} className="st-link-row">
                  <label className="field">
                    <span>Link text</span>
                    <input value={link.label} onChange={(e) => patch({ footer: { ...site.footer, links: site.footer.links.map((x, i) => (i === index ? { ...x, label: e.target.value } : x)) } })} />
                  </label>
                  <label className="field">
                    <span>Address (/page or https://…)</span>
                    <input value={link.href} onChange={(e) => patch({ footer: { ...site.footer, links: site.footer.links.map((x, i) => (i === index ? { ...x, href: e.target.value } : x)) } })} />
                  </label>
                  <button type="button" className="btn btn--danger-ghost btn--sm" onClick={() => patch({ footer: { ...site.footer, links: site.footer.links.filter((_, i) => i !== index) } })}>
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>
        </fieldset>

        <FooterEditor site={site} pages={data.pages ?? []} patch={patch} />
      </div>

      <div {...tabPanelProps(P, "labels", tab)} className="sa-stack">
        <div className="st-search">
          <input
            type="search"
            value={labelQuery}
            onChange={(e) => setLabelQuery(e.target.value)}
            placeholder="Filter labels (e.g. sidebar, topic, button, 404…)"
            aria-label="Filter interface labels"
          />
          {q ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setLabelQuery("")}>
              Clear filter
            </button>
          ) : (
            <span className="sa-pill">52 labels across {groups.length} groups</span>
          )}
        </div>

        {groups.map((group) => {
          const items = q
            ? group.items.filter(([key, name]) =>
                name.toLowerCase().includes(q) ||
                key.toLowerCase().includes(q) ||
                (site.labels[key] ?? "").toLowerCase().includes(q) ||
                group.title.toLowerCase().includes(q),
              )
            : group.items;
          if (items.length === 0) return null;
          return (
            <fieldset className="block-card sa-card" key={group.title}>
              <legend>{group.title}</legend>
              <div className="st-labels-grid">
                {items.map(([key, name]) => (
                  <LabelField key={key} name={name} value={site.labels[key]} fallback={defaults.labels[key]} onChange={(v) => setLabel(key, v)} />
                ))}
              </div>
            </fieldset>
          );
        })}

        {other.length > 0 ? (
          <fieldset className="block-card sa-card">
            <legend>Other</legend>
            <div className="st-labels-grid">
              {other.map((key) => (
                <LabelField key={key} name={key} value={site.labels[key]} fallback={defaults.labels[key]} onChange={(v) => setLabel(key, v)} />
              ))}
            </div>
          </fieldset>
        ) : null}
      </div>

      <div {...tabPanelProps(P, "consent", tab)} className="sa-stack">
        <fieldset className="block-card sa-card">
          <legend>Cookie consent</legend>
          <label className="field" style={{ margin: 0 }}>
            <span>Consent message</span>
            <textarea rows={3} value={site.analytics.consentText} onChange={(e) => patch({ analytics: { ...site.analytics, consentText: e.target.value } })} required maxLength={500} />
          </label>
        </fieldset>

        <fieldset className="block-card sa-card">
          <legend>About page</legend>
          <p className="sa-note">The public About page is managed in <a href="/admin/pages">Pages → About Us</a>. The earlier Site text copy is preserved below for comparison; it does not appear publicly.</p>
          <details>
            <summary>Earlier About copy (preserved)</summary>
            {site.about.paragraphs.map((paragraph, i) => <p key={i}>{paragraph}</p>)}
          </details>
        </fieldset>
      </div>
    </FormShell>
  );
}

function LabelField({ name, value, fallback, onChange }: { name: string; value: string; fallback: string; onChange: (v: string) => void }) {
  return (
    <div className="st-label-item">
      <label className="field">
        <span>{name}</span>
        <input value={value} onChange={(e) => onChange(e.target.value)} onBlur={(e) => (e.target.value.trim() ? null : onChange(fallback))} />
      </label>
      {value !== fallback ? (
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange(fallback)} title={`Default: ${fallback}`}>
          Reset
        </button>
      ) : null}
    </div>
  );
}

function navTarget(href: NavHref, categories: { slug: string; label: string }[]): string {
  if (href === "/") return "Home";
  if (href.startsWith("/topics/")) {
    const slug = href.slice("/topics/".length);
    return `topic “${categories.find((c) => c.slug === slug)?.label ?? slug}”`;
  }
  return href;
}

/** t96: add a menu shortcut to one topic (inserted before About). */
function AddTopicShortcut({ categories, disabled, onAdd }: { categories: { slug: string; label: string }[]; disabled: boolean; onAdd: (c: { slug: string; label: string }) => void }) {
  const [slug, setSlug] = useState("");
  const chosen = categories.find((c) => c.slug === slug) ?? categories[0];
  if (categories.length === 0) return null;
  return (
    <div className="st-add-row">
      <label className="field">
        <span>Add a topic shortcut</span>
        <select value={chosen?.slug ?? ""} onChange={(e) => setSlug(e.target.value)} disabled={disabled}>
          {categories.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="btn btn--ghost btn--sm" disabled={disabled || !chosen} onClick={() => chosen && onAdd(chosen)}>
        + Add to menu
      </button>
      {disabled ? <span className="field-help">The menu holds up to 8 items.</span> : null}
    </div>
  );
}
