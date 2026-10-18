import { useEffect, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BlockEditor } from "@/components/admin/block-editor";
import { FormShell, useSiteForm } from "@/components/admin/site-form";
import { adminSettings, adminTaxonomy } from "@/content/admin-api";
import { defaultTitle } from "@/content/blocks";
import { HOME_BLOCK_TYPES, SIDEBAR_BLOCK_TYPES } from "@/content/validate";

export const Route = createFileRoute("/admin/homepage")({
  loader: async () => {
    const [settings, taxonomy] = await Promise.all([adminSettings(), adminTaxonomy()]);
    return { site: settings.site, categories: taxonomy.categories, tags: taxonomy.tags };
  },
  component: HomepageAdmin,
});

function HomepageAdmin() {
  const data = Route.useLoaderData();
  const form = useSiteForm(data.site);
  const { site, patch } = form;
  const frame = useRef<HTMLIFrameElement>(null);
  const side = site.articleSidebar;
  const categories = data.categories.map((c) => ({ id: c.id, label: c.label }));
  const tags = data.tags.map((t) => ({ id: t.id, label: t.label }));
  const title = (b: Parameters<typeof defaultTitle>[0]) => defaultTitle(b, site.labels, data.categories, data.tags);

  // Live preview: send the unsaved blocks to the preview frame on every change.
  const draft = JSON.stringify({ home: site.home, trending: site.trending, labels: site.labels });
  useEffect(() => {
    const timer = window.setTimeout(() => frame.current?.contentWindow?.postMessage({ type: "dypol-home-draft", draft }, window.location.origin), 250);
    return () => window.clearTimeout(timer);
  }, [draft]);

  return (
    <FormShell
      kicker="Site"
      title="Homepage builder"
      intro="Add, remove, reorder and edit the blocks on your homepage and in the article sidebar. The preview on the right updates as you edit; nothing changes for visitors until you save."
      form={form}
    >
      <div className="adm-builder">
        <div className="stack">
          <fieldset className="block-card">
            <legend>Homepage blocks</legend>
            <BlockEditor
              prefix="home"
              blocks={site.home.blocks}
              onChange={(blocks) => patch({ home: { blocks } })}
              types={HOME_BLOCK_TYPES}
              categories={categories}
              tags={tags}
              defaultTitle={title}
            />
          </fieldset>
          <fieldset className="block-card">
            <legend>Article sidebar</legend>
            <label className="check-row">
              <input type="checkbox" checked={side.enabled} onChange={(e) => patch({ articleSidebar: { ...side, enabled: e.target.checked } })} />
              Show the sidebar next to articles (off = articles use the full width)
            </label>
            {side.enabled ? (
              <BlockEditor
                prefix="side"
                blocks={side.blocks}
                onChange={(blocks) => patch({ articleSidebar: { ...side, blocks } })}
                types={SIDEBAR_BLOCK_TYPES}
                categories={categories}
                tags={tags}
                defaultTitle={title}
              />
            ) : null}
          </fieldset>
        </div>
        <div className="adm-preview">
          <p className="adm-group__label">Live preview (homepage, unsaved)</p>
          <iframe ref={frame} title="Homepage preview" src="/preview/home" onLoad={() => frame.current?.contentWindow?.postMessage({ type: "dypol-home-draft", draft }, window.location.origin)} />
        </div>
      </div>
    </FormShell>
  );
}
