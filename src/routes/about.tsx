import { createFileRoute, notFound } from "@tanstack/react-router";
import { NotFoundState, PagePending } from "@/components/site/states";
import { StaticPage } from "@/components/site/static-page";
import { getPage } from "@/content/public-api";
import { absoluteUrl, socialMeta } from "@/lib/seo";

/** About Us (t52): content lives in the Pages system (Admin → Pages). */
export const Route = createFileRoute("/about")({
  loader: async () => {
    const data = await getPage({ data: { slug: "about" } });
    if (!data) throw notFound();
    return data;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "About Us — DYPOL Blog" }] };
    const origin = loaderData.origin ?? "";
    const title = "About Us — DYPOL Blog";
    return {
      meta: [
        { title },
        { name: "description", content: loaderData.description },
        ...socialMeta({ title, description: loaderData.description, url: absoluteUrl(origin, "/about"), type: "website", siteName: "DYPOL Blog", image: absoluteUrl(origin, "/og.jpg") }),
      ],
      links: [{ rel: "canonical", href: absoluteUrl(origin, "/about") }],
    };
  },
  pendingComponent: PagePending,
  notFoundComponent: NotFoundState,
  component: AboutRoute,
});

function AboutRoute() {
  const data = Route.useLoaderData();
  return <StaticPage page={data} />;
}
