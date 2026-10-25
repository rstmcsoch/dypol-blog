import { createFileRoute, notFound } from "@tanstack/react-router";
import { NotFoundState } from "@/components/site/states";
import { sitePageTitle } from "@/lib/seo";

export const Route = createFileRoute("/$")({
  loader: () => {
    throw notFound();
  },
  head: () => ({
    meta: [
      { title: sitePageTitle("Not found") },
      { name: "robots", content: "noindex" },
    ],
  }),
  notFoundComponent: NotFoundState,
  component: NotFoundState,
});