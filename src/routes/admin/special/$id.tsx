import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { adminPending } from "@/components/admin/pending";
import { SpecialEditor } from "@/components/admin/special/special-editor";
import { adminSpecialEditorData } from "@/content/admin-api";

export const Route = createFileRoute("/admin/special/$id")({
  ...adminPending,
  head: () => ({ meta: [{ title: "Special article · DYPOL desk" }] }),
  loader: async ({ params }) => {
    const data = await adminSpecialEditorData({ data: { id: params.id } });
    if (data.notSpecial) throw redirect({ to: "/admin/articles/$id", params: { id: params.id } });
    if (!data.article) throw notFound();
    return data;
  },
  component: EditSpecial,
});

function EditSpecial() {
  const data = Route.useLoaderData();
  if (!data.article) return null;
  return (
    <SpecialEditor
      key={data.article.id}
      article={data.article}
      body={data.special?.body ?? null}
      versions={data.special?.versions ?? []}
      autosave={data.special?.autosave ?? null}
      autosaveAt={data.special?.autosaveAt ?? null}
      categories={data.categories}
      tags={data.tags}
      media={data.media}
    />
  );
}
