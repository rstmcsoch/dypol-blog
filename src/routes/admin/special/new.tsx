import { createFileRoute } from "@tanstack/react-router";
import { adminPending } from "@/components/admin/pending";
import { SpecialEditor } from "@/components/admin/special/special-editor";
import { adminSpecialEditorData } from "@/content/admin-api";

export const Route = createFileRoute("/admin/special/new")({
  ...adminPending,
  head: () => ({ meta: [{ title: "New special article · DYPOL desk" }] }),
  loader: () => adminSpecialEditorData({ data: { id: null } }),
  component: NewSpecial,
});

function NewSpecial() {
  const data = Route.useLoaderData();
  return <SpecialEditor article={null} body={null} categories={data.categories} tags={data.tags} media={data.media} />;
}
