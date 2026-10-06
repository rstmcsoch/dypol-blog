import { createFileRoute, notFound } from "@tanstack/react-router";
import { NotFoundState } from "@/components/site/states";
import { site } from "@/content/site";

export const Route = createFileRoute("/$")({
  loader: () => {
    throw notFound();
  },
  head: () => ({
    meta: [
      { title: `${site.labels.notFoundKicker} — ${site.name}` },
      { name: "robots", content: "noindex" },
    ],
  }),
  notFoundComponent: NotFoundState,
  component: NotFoundState,
});