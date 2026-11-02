import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { SpecialView } from "@/components/site/special-view";
import { adminSpecialPreview } from "@/content/admin-api";
import { sitePageTitle } from "@/lib/seo";

/** t173: admin-only preview of a special article in any status (never public, noindex). */
export const Route = createFileRoute("/preview/special/$id")({
  loader: async ({ params }) => {
    try {
      const data = await adminSpecialPreview({ data: { id: params.id } });
      if (!data) throw notFound();
      return data;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("Unauthorized") || message.includes("Forbidden")) {
        throw redirect({ to: "/admin", search: { denied: message.includes("Forbidden") } });
      }
      throw error;
    }
  },
  head: () => ({ meta: [{ title: sitePageTitle("Preview") }, { name: "robots", content: "noindex" }] }),
  component: SpecialPreview,
});

function SpecialPreview() {
  const data = Route.useLoaderData();
  return <SpecialView {...data} site={data.site} preview />;
}
