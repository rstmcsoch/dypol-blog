import { createFileRoute } from "@tanstack/react-router";
import { ArticleEditor } from "@/components/admin/editor";
import { adminEditorData } from "@/content/admin-api";

export const Route = createFileRoute("/admin/articles/new")({
  loader: () => adminEditorData({ data: { id: null } }),
  component: NewPiece,
});

function NewPiece() {
  const data = Route.useLoaderData();
  return <ArticleEditor article={null} categories={data.categories} tags={data.tags} media={data.media} />;
}
