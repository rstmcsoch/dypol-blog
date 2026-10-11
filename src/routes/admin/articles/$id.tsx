import { createFileRoute, notFound } from "@tanstack/react-router";
import { ArticleEditor } from "@/components/admin/editor";
import { adminEditorData } from "@/content/admin-api";

export const Route = createFileRoute("/admin/articles/$id")({
  loader: async ({ params }) => {
    const data = await adminEditorData({ data: { id: params.id } });
    if (!data.article) throw notFound();
    return data;
  },
  component: EditPiece,
});

function EditPiece() {
  const data = Route.useLoaderData();
  if (!data.article) return null;
  return (
    <ArticleEditor article={data.article} categories={data.categories} tags={data.tags} media={data.media} />
  );
}
