import { createFileRoute } from "@tanstack/react-router";
import { LayoutBuilder } from "@/components/admin/layout-builder";
import { adminLayout, adminSettings } from "@/content/admin-api";

export const Route = createFileRoute("/admin/homepage")({
  loader: async () => {
    const [layout, settings] = await Promise.all([adminLayout(), adminSettings()]);
    return { layout, site: settings.site };
  },
  component: HomepageBuilder,
});

function HomepageBuilder() {
  const { layout, site } = Route.useLoaderData();
  return <LayoutBuilder area="homepage" state={layout.state} options={layout.options} site={site} />;
}
