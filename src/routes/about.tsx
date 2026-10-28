import { createFileRoute, notFound } from "@tanstack/react-router";
import { NotFoundState, PagePending } from "@/components/site/states";
import { StaticPage } from "@/components/site/static-page";
import { getPage } from "@/content/public-api";
import { defaultOgPath, absoluteUrl, breadcrumbJsonLd, metaDescription, sitePageTitle, socialMeta } from "@/lib/seo";

/** About Us (t52): content lives in the Pages system (Admin → Pages). */
export const Route = createFileRoute("/about")({
  loader: async () => {
    const data = await getPage({ data: { slug: "about" } });
    if (!data) throw notFound();
    return data;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: sitePageTitle("About Us") }] };
    const origin = loaderData.origin ?? "";
    const title = sitePageTitle(loaderData.title, loaderData.site.name);
    const description = metaDescription(loaderData.description, title);
    return {
      meta: [
        { title },
        { name: "description", content: description },
        ...socialMeta({ title, description, url: absoluteUrl(origin, "/about"), type: "website", siteName: loaderData?.site.name, image: absoluteUrl(origin, defaultOgPath(loaderData?.site ?? {})) }),
      ],
      links: [{ rel: "canonical", href: absoluteUrl(origin, "/about") }],
      scripts: [{ type: "application/ld+json", children: JSON.stringify(breadcrumbJsonLd({ origin, items: [{ name: "Home", path: "/" }, { name: "About Us", path: "/about" }] })) }],
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
