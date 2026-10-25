import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { FormShell, move, useSiteForm } from "@/components/admin/site-form";
import { adminSettings, adminTaxonomy } from "@/content/admin-api";
import { site as defaults } from "@/content/site";
import type { NavHref, SiteConfig } from "@/content/types";

export const Route = createFileRoute("/admin/site-text")({
  loader: async () => {
    const [settings, taxonomy] = await Promise.all([adminSettings(), adminTaxonomy()]);
    return { ...settings, categories: taxonomy.categories.map((c) => ({ slug: c.slug, label: c.label })) };
  },
  component: SiteTextAdmin,
});

type LabelKey = keyof SiteConfig["labels"];

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
  const setLabel = (key: LabelKey, value: string) => patch({ labels: { ...site.labels, [key]: value } });
  const covered = new Set(groups.flatMap((g) => g.items.map(([k]) => k)));
  const other = (Object.keys(site.labels) as LabelKey[]).filter((k) => !covered.has(k));

  return (
    <FormShell kicker="Site" title="Site text" intro="Every word visitors see outside your articles: menu, headings, buttons, footer and the About page. Empty or reset fields go back to the default text." form={form}>
      <fieldset className="block-card">
        <legend>Main menu</legend>
        <p className="field-help">About five visible items reads best. Topic shortcuts link straight to one topic page and only show while that topic has published stories.</p>
        {site.nav.map((item, index) => (
          <div key={item.id} className="filters" style={{ alignItems: "center" }}>
            <label className="field">
              <span>Label for {navTarget(item.href, data.categories)}</span>
              <input value={item.label} onChange={(e) => patch({ nav: site.nav.map((x, i) => (i === index ? { ...x, label: e.target.value } : x)) })} />
            </label>
            <label className="check-row">
              <input type="checkbox" checked={item.visible} onChange={(e) => patch({ nav: site.nav.map((x, i) => (i === index ? { ...x, visible: e.target.checked } : x)) })} />
              Visible
            </label>
            <div className="adm-row-actions">
              <button type="button" className="btn btn--ghost" aria-label={`Move ${item.label} up`} disabled={index === 0} onClick={() => patch({ nav: move(site.nav, index, -1) })}>
                ↑
              </button>
              <button type="button" className="btn btn--ghost" aria-label={`Move ${item.label} down`} disabled={index === site.nav.length - 1} onClick={() => patch({ nav: move(site.nav, index, 1) })}>
                ↓
              </button>
              {item.href.startsWith("/topics/") ? (
                <button type="button" className="btn btn--danger-ghost" aria-label={`Remove ${item.label}`} onClick={() => patch({ nav: site.nav.filter((_, i) => i !== index) })}>
                  Remove
                </button>
              ) : null}
            </div>
          </div>
        ))}
        <AddTopicShortcut
          categories={data.categories.filter((c) => !site.nav.some((item) => item.href === `/topics/${c.slug}`))}
          disabled={site.nav.length >= 8}
          onAdd={(c) => patch({ nav: [...site.nav.filter((item) => item.id !== "about"), { id: `topic-${c.slug}`.slice(0, 40), label: c.label, href: `/topics/${c.slug}`, visible: true }, ...site.nav.filter((item) => item.id === "about")] })}
        />
      </fieldset>

      <fieldset className="block-card">
        <legend>Footer</legend>
        <label className="field">
          <span>Footer line</span>
          <input value={site.footer.note} onChange={(e) => patch({ footer: { ...site.footer, note: e.target.value } })} />
        </label>
        {site.footer.links.map((link, index) => (
          <div key={link.id} className="filters">
            <label className="field">
              <span>Link text</span>
              <input value={link.label} onChange={(e) => patch({ footer: { ...site.footer, links: site.footer.links.map((x, i) => (i === index ? { ...x, label: e.target.value } : x)) } })} />
            </label>
            <label className="field">
              <span>Address (/page or https://…)</span>
              <input value={link.href} onChange={(e) => patch({ footer: { ...site.footer, links: site.footer.links.map((x, i) => (i === index ? { ...x, href: e.target.value } : x)) } })} />
            </label>
            <button type="button" className="btn btn--danger-ghost" onClick={() => patch({ footer: { ...site.footer, links: site.footer.links.filter((_, i) => i !== index) } })}>
              Remove
            </button>
          </div>
        ))}
        <p>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={site.footer.links.length >= 8}
            onClick={() => patch({ footer: { ...site.footer, links: [...site.footer.links, { id: `link-${Date.now()}`, label: "New link", href: "/" satisfies NavHref }] } })}
          >
            Add footer link
          </button>
        </p>
      </fieldset>

      <fieldset className="block-card">
        <legend>About page text</legend>
        <label className="field">
          <span>One paragraph per block; leave a blank line between paragraphs.</span>
          <textarea
            rows={10}
            value={site.about.paragraphs.join("\n\n")}
            onChange={(e) => patch({ about: { paragraphs: e.target.value.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) } })}
          />
        </label>
      </fieldset>

      {groups.map((group) => (
        <fieldset className="block-card" key={group.title}>
          <legend>{group.title}</legend>
          {group.items.map(([key, name]) => (
            <LabelField key={key} name={name} value={site.labels[key]} fallback={defaults.labels[key]} onChange={(v) => setLabel(key, v)} />
          ))}
        </fieldset>
      ))}
      {other.length > 0 ? (
        <fieldset className="block-card">
          <legend>Other</legend>
          {other.map((key) => (
            <LabelField key={key} name={key} value={site.labels[key]} fallback={defaults.labels[key]} onChange={(v) => setLabel(key, v)} />
          ))}
        </fieldset>
      ) : null}
    </FormShell>
  );
}

function LabelField({ name, value, fallback, onChange }: { name: string; value: string; fallback: string; onChange: (v: string) => void }) {
  return (
    <div className="filters" style={{ alignItems: "end" }}>
      <label className="field">
        <span>{name}</span>
        <input value={value} onChange={(e) => onChange(e.target.value)} onBlur={(e) => (e.target.value.trim() ? null : onChange(fallback))} />
      </label>
      {value !== fallback ? (
        <button type="button" className="btn btn--ghost" onClick={() => onChange(fallback)} title={`Default: ${fallback}`}>
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
    <div className="filters" style={{ alignItems: "flex-end" }}>
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
      <button type="button" className="btn btn--ghost" disabled={disabled || !chosen} onClick={() => chosen && onAdd(chosen)}>
        Add to menu
      </button>
      {disabled ? <span className="field-help">The menu holds up to 8 items.</span> : null}
    </div>
  );
}
