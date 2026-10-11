import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { ArticleView } from "@/components/site/article-view";
import { adminPreview } from "@/content/admin-api";

export const Route = createFileRoute("/preview/$id")({
  loader: async ({ params }) => {
    try {
      const data = await adminPreview({ data: { id: params.id } });
      if (!data) throw notFound();
      return data;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("Unauthorized") || message.includes("Forbidden")) {
        throw redirect({ to: "/login", search: { denied: message.includes("Forbidden") } });
      }
      throw error;
    }
  },
  head: () => ({
    meta: [
      { title: "Preview — DYPOL Blog" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PreviewPage,
});

function PreviewPage() {
  const data = Route.useLoaderData();
  return <ArticleView {...data} site={data.site} />;
}
