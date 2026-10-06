import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { errorText } from "@/components/admin/gate";
import { adminAddGrant, adminRemoveGrant, adminSaveSettings, adminSettings } from "@/content/admin-api";
import type { NavHref, SiteConfig } from "@/content/types";

export const Route = createFileRoute("/admin/settings")({
  loader: () => adminSettings(),
  component: SettingsDesk,
});

function SettingsDesk() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const [site, setSite] = useState<SiteConfig>(data.site);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [grant, setGrant] = useState("");

  function patch(next: Partial<SiteConfig>) {
    setSite((current) => ({ ...current, ...next }));
  }

  return (
    <>
      <p className="desk-kicker">Configuration</p>
      <h1 className="desk-title">Settings</h1>
      <p className="desk-note">
        {data.mode === "dev"
          ? "Sign-in is off in this environment, so the desk is open to this preview. When sign-in is on, only emails in ADMIN_EMAILS or the grant list can publish."
          : `Signed in as ${data.email ?? "an editor"}.`}
      </p>
      {data.mediaNotice ? (
        <p className="banner banner--bad" role="alert">
          {data.mediaNotice}
        </p>
      ) : null}
      {error ? (
        <p className="banner banner--bad" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="banner" role="status">
          {message}
        </p>
      ) : null}
      <form
        className="stack"
        style={{ marginTop: "1rem" }}
        onSubmit={(event) => {
          event.preventDefault();
          setPending(true);
          setError(null);
          void adminSaveSettings({ data: site })
            .then(async () => {
              setMessage("Settings saved.");
              await router.invalidate();
            })
            .catch((caught: unknown) => setError(errorText(caught)))
            .finally(() => setPending(false));
        }}
      >
        <label className="field">
          <span>Website name</span>
          <input value={site.name} onChange={(event) => patch({ name: event.target.value })} required />
        </label>
        <label className="field">
          <span>Site title</span>
          <input value={site.title} onChange={(event) => patch({ title: event.target.value })} required />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea value={site.description} onChange={(event) => patch({ description: event.target.value })} required />
        </label>
        <label className="field">
          <span>Publisher</span>
          <input value={site.publisher} onChange={(event) => patch({ publisher: event.target.value })} required />
        </label>
        <label className="field">
          <span>Logo</span>
          <select
            value={site.logoMediaId ?? ""}
            onChange={(event) => patch({ logoMediaId: event.target.value || null })}
          >
            <option value="">Wordmark only</option>
            {data.media.map((item) => (
              <option key={item.id} value={item.id}>
                {item.filename}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Favicon</span>
          <select
            value={site.faviconMediaId ?? ""}
            onChange={(event) => patch({ faviconMediaId: event.target.value || null })}
          >
            <option value="">Default mark</option>
            {data.media.map((item) => (
              <option key={item.id} value={item.id}>
                {item.filename}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="block-card">
          <legend>Navigation</legend>
          {site.nav.map((item, index) => (
            <div key={item.id} className="filters">
              <label className="field">
                <span>{item.href}</span>
                <input
                  value={item.label}
                  onChange={(event) => {
                    const nav = site.nav.map((entry, entryIndex) =>
                      entryIndex === index ? { ...entry, label: event.target.value } : entry,
                    );
                    patch({ nav });
                  }}
                />
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={item.visible}
                  onChange={(event) => {
                    const nav = site.nav.map((entry, entryIndex) =>
                      entryIndex === index ? { ...entry, visible: event.target.checked } : entry,
                    );
                    patch({ nav });
                  }}
                />
                Visible
              </label>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  if (index === 0) return;
                  const nav = [...site.nav];
                  const [moved] = nav.splice(index, 1);
                  if (!moved) return;
                  nav.splice(index - 1, 0, moved);
                  patch({ nav });
                }}
              >
                Up
              </button>
            </div>
          ))}
        </fieldset>
        <fieldset className="block-card">
          <legend>Now bar</legend>
          <label className="check-row">
            <input
              type="checkbox"
              checked={site.trending.enabled}
              onChange={(event) => patch({ trending: { ...site.trending, enabled: event.target.checked } })}
            />
            Enabled
          </label>
          <label className="field">
            <span>Label</span>
            <input
              value={site.trending.label}
              onChange={(event) => patch({ trending: { ...site.trending, label: event.target.value } })}
            />
          </label>
          {data.articles.map((article) => (
            <label key={article.slug} className="check-row">
              <input
                type="checkbox"
                checked={site.trending.slugs.includes(article.slug)}
                onChange={(event) => {
                  const slugs = event.target.checked
                    ? [...site.trending.slugs, article.slug]
                    : site.trending.slugs.filter((slug) => slug !== article.slug);
                  patch({ trending: { ...site.trending, slugs } });
                }}
              />
              {article.title}
            </label>
          ))}
        </fieldset>
        <label className="field">
          <span>Footer note</span>
          <input
            value={site.footer.note}
            onChange={(event) => patch({ footer: { ...site.footer, note: event.target.value } })}
          />
        </label>
        <fieldset className="block-card">
          <legend>Footer links</legend>
          {site.footer.links.map((link, index) => (
            <div key={link.id} className="filters">
              <label className="field">
                <span>Label</span>
                <input
                  value={link.label}
                  onChange={(event) => {
                    const links = site.footer.links.map((entry, entryIndex) =>
                      entryIndex === index ? { ...entry, label: event.target.value } : entry,
                    );
                    patch({ footer: { ...site.footer, links } });
                  }}
                />
              </label>
              <label className="field">
                <span>URL</span>
                <input
                  value={link.href}
                  onChange={(event) => {
                    const links = site.footer.links.map((entry, entryIndex) =>
                      entryIndex === index ? { ...entry, href: event.target.value } : entry,
                    );
                    patch({ footer: { ...site.footer, links } });
                  }}
                />
              </label>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() =>
                  patch({ footer: { ...site.footer, links: site.footer.links.filter((_, i) => i !== index) } })
                }
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() =>
              patch({
                footer: {
                  ...site.footer,
                  links: [...site.footer.links, { id: `link-${Date.now()}`, label: "Link", href: "/" satisfies NavHref }],
                },
              })
            }
          >
            Add link
          </button>
        </fieldset>
        <label className="field">
          <span>About, one paragraph per block. Separate paragraphs with a blank line.</span>
          <textarea
            value={site.about.paragraphs.join("\n\n")}
            onChange={(event) =>
              patch({
                about: {
                  paragraphs: event.target.value
                    .split(/\n\s*\n/)
                    .map((paragraph) => paragraph.trim())
                    .filter(Boolean),
                },
              })
            }
          />
        </label>
        <details className="block-card">
          <summary>Presentation labels</summary>
          <div className="stack">
            {(Object.keys(site.labels) as (keyof SiteConfig["labels"])[]).map((key) => (
              <label key={key} className="field">
                <span>{key}</span>
                <input
                  value={site.labels[key]}
                  onChange={(event) => patch({ labels: { ...site.labels, [key]: event.target.value } })}
                />
              </label>
            ))}
          </div>
        </details>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </button>
      </form>
      <section className="desk-section">
        <h2>Editor grants</h2>
        <p className="desk-note">These emails can use the desk when sign-in is on and ADMIN_EMAILS is unset.</p>
        <ul>
          {data.grants.map((email) => (
            <li key={email}>
              {email}{" "}
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  void adminRemoveGrant({ data: { email } }).then(() => router.invalidate());
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <form
          className="filters"
          onSubmit={(event) => {
            event.preventDefault();
            void adminAddGrant({ data: { email: grant } })
              .then(async () => {
                setGrant("");
                setMessage("Grant saved.");
                await router.invalidate();
              })
              .catch((caught: unknown) => setError(errorText(caught)));
          }}
        >
          <label className="field">
            <span>Email</span>
            <input type="email" value={grant} onChange={(event) => setGrant(event.target.value)} required />
          </label>
          <button className="btn" type="submit">
            Add editor
          </button>
        </form>
      </section>
    </>
  );
}
