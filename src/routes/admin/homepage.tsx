import { useEffect, useState } from "react";
import { homeDraftPayload } from "@/lib/admin-tabs";
import { HomePreviewDialog } from "@/components/admin/home-preview-dialog";
import { adminPending } from "@/components/admin/pending";
import { createFileRoute } from "@tanstack/react-router";
import { BlockEditor } from "@/components/admin/block-editor";
import { FormShell, useSiteForm } from "@/components/admin/site-form";
import { adminSettings, adminTaxonomy } from "@/content/admin-api";
import { defaultTitle } from "@/content/blocks";
import { HOME_BLOCK_TYPES, SIDEBAR_BLOCK_TYPES } from "@/content/validate";

export const Route = createFileRoute("/admin/homepage")({
  ...adminPending,
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
  const [previewOpen, setPreviewOpen] = useState(false);
  const side = site.articleSidebar;
  const categories = data.categories.map((c) => ({ id: c.id, label: c.label }));
  const tags = data.tags.map((t) => ({ id: t.id, label: t.label }));
  const title = (b: Parameters<typeof defaultTitle>[0]) =>
    defaultTitle(b, site.labels, data.categories, data.tags);

  // t217: the draft lives only in this component's memory. Leaving the route unmounts it; a
  // back/forward restore from the browser cache reloads so stored settings are shown, never the draft.
  const draft = homeDraftPayload(site);
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  return (
    <FormShell
      kicker="Site"
      title="Homepage builder"
      intro="Add, remove, reorder and edit the blocks on your homepage and in the article sidebar. Use Preview to see your unsaved homepage; nothing changes for visitors until you save. Unsaved changes are discarded when you leave this page."
      form={form}
      actions={
        <button type="button" className="btn btn--ghost" onClick={() => setPreviewOpen(true)}>
          Preview
        </button>
      }
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
              <input
                type="checkbox"
                checked={side.enabled}
                onChange={(e) => patch({ articleSidebar: { ...side, enabled: e.target.checked } })}
              />
              Show the sidebar next to articles (off = articles use the full width)
            </label>
            {side.enabled ? (
              <BlockEditor
                prefix="side"
                blocks={side.blocks}
                onChange={(blocks) => patch({ articleSidebar: { ...side, blocks } })}
                share={site.share}
                onShareChange={(share) => patch({ share })}
                types={SIDEBAR_BLOCK_TYPES}
                categories={categories}
                tags={tags}
                defaultTitle={title}
              />
            ) : null}
          </fieldset>
        </div>
      </div>
      <HomePreviewDialog open={previewOpen} onClose={() => setPreviewOpen(false)} draft={draft} />
    </FormShell>
  );
}
