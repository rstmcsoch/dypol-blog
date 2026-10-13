import { createFileRoute } from "@tanstack/react-router";
import { LayoutBuilder } from "@/components/admin/layout-builder";
import { adminLayout, adminSettings } from "@/content/admin-api";

export const Route = createFileRoute("/admin/sidebar")({
  loader: async () => {
    const [layout, settings] = await Promise.all([adminLayout(), adminSettings()]);
    return { layout, site: settings.site };
  },
  component: SidebarManager,
});

function SidebarManager() {
  const { layout, site } = Route.useLoaderData();
  return <LayoutBuilder area="sidebar" state={layout.state} options={layout.options} site={site} />;
}
