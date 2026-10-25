import { createFileRoute } from "@tanstack/react-router";
import { adminPending } from "@/components/admin/pending";
import { FormShell, useSiteForm } from "@/components/admin/site-form";
import { adminSettings } from "@/content/admin-api";
import { site as defaults } from "@/content/site";
import type { Appearance, CoverFallback } from "@/content/types";
import { accentInk, contrast, themeColors } from "@/lib/appearance";

export const Route = createFileRoute("/admin/appearance")({
  ...adminPending,
  loader: () => adminSettings(),
  component: AppearanceAdmin,
});

const coverChoices: { value: CoverFallback; name: string; help: string }[] = [
  { value: "minimal", name: "Simple panel", help: "A quiet panel with the topic and title. Recommended." },
  { value: "plate", name: "Pattern", help: "The original geometric pattern with orange blocks and a number." },
  { value: "none", name: "No cover", help: "Articles without an image start straight with the text." },
];

function AppearanceAdmin() {
  const data = Route.useLoaderData();
  const form = useSiteForm(data.site);
  const a = form.site.appearance;
  const set = (next: Partial<Appearance>) => form.patch({ appearance: { ...a, ...next } });
  const colors = themeColors(a);
  const ink = accentInk(a.accent);

  return (
    <FormShell kicker="Site" title="Appearance" intro="Colours of the public site. The admin panel always keeps its own light look." form={form}>
      <fieldset className="block-card">
        <legend>Theme colours</legend>
        <label className="field">
          <span>
            Night theme darkness: {a.darkness}% (page colour {colors.dark.paper})
          </span>
          <input type="range" min={75} max={100} value={a.darkness} onChange={(e) => set({ darkness: Number(e.target.value) })} aria-describedby="dark-help" />
          <small id="dark-help">100% is pure black. Lower values give a softer charcoal grey. Text colours adjust automatically to stay readable.</small>
        </label>
        <label className="field">
          <span>
            Day theme whiteness: {a.whiteness}% (page colour {colors.light.paper})
          </span>
          <input type="range" min={85} max={100} value={a.whiteness} onChange={(e) => set({ whiteness: Number(e.target.value) })} />
          <small>100% is pure white. Lower values give a soft off-white.</small>
        </label>
        <div className="filters" style={{ alignItems: "center" }}>
          <label className="field" style={{ maxWidth: "14rem" }}>
            <span>Accent colour</span>
            <span className="check-row">
              <input type="color" value={a.accent} onChange={(e) => set({ accent: e.target.value })} aria-label="Accent colour picker" />
              <input value={a.accent} onChange={(e) => set({ accent: e.target.value })} aria-label="Accent colour hex code" style={{ maxWidth: "7rem" }} />
            </span>
          </label>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => set({ darkness: defaults.appearance.darkness, whiteness: defaults.appearance.whiteness, accent: defaults.appearance.accent })}
          >
            Reset colours
          </button>
        </div>
      </fieldset>

      <fieldset className="block-card">
        <legend>Live preview</legend>
        <div className="adm-preview" data-testid="appearance-preview">
          {(["light", "dark"] as const).map((mode) => {
            const c = colors[mode];
            return (
              <div key={mode} className="adm-preview__pane" style={{ background: c.paper, color: c.ink, borderColor: c.muted }}>
                <span className="adm-preview__chip" style={{ background: a.accent, color: ink }}>
                  {mode === "light" ? "Day" : "Night"}
                </span>
                <h3>An article headline</h3>
                <p style={{ color: c.muted }}>Secondary text, dates and captions look like this.</p>
                <p>Body text reads like this paragraph.</p>
                <small style={{ color: c.muted }}>
                  Contrast: text {contrast(c.ink, c.paper).toFixed(1)}:1 · secondary {contrast(c.muted, c.paper).toFixed(1)}:1
                </small>
              </div>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="block-card">
        <legend>Articles without a cover image</legend>
        <p className="field-help">What the top of an article (and the featured article on the homepage) shows when no cover image is set.</p>
        {coverChoices.map((choice) => (
          <label key={choice.value} className="check-row" style={{ alignItems: "start" }}>
            <input type="radio" name="coverFallback" checked={a.coverFallback === choice.value} onChange={() => set({ coverFallback: choice.value })} />
            <span>
              <strong>{choice.name}</strong>
              <br />
              <small className="field-help">{choice.help}</small>
            </span>
          </label>
        ))}
      </fieldset>
    </FormShell>
  );
}
