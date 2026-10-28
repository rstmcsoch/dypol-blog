import { createFileRoute, notFound } from "@tanstack/react-router";
import { NotFoundState, PagePending } from "@/components/site/states";
import { StaticPage } from "@/components/site/static-page";
import { getPage } from "@/content/public-api";
import { defaultOgPath, absoluteUrl, breadcrumbJsonLd, metaDescription, sitePageTitle, socialMeta } from "@/lib/seo";

/**
 * Standard reader-facing pages (t52): /privacy-policy, /terms, /dmca,
 * /cookie-policy, /editorial-policy, /corrections-policy, /contact,
 * /disclaimer — plus any page the owner creates in Admin → Pages.
 * Static routes (e.g. /about, /articles) always win over this segment.
 */
export const Route = createFileRoute("/$page")({
  loader: async ({ params }) => {
    const data = await getPage({ data: { slug: params.page } });
    if (!data) throw notFound();
    return data;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: sitePageTitle("Not found") }, { name: "robots", content: "noindex" }] };
    const origin = loaderData.origin ?? "";
    const title = sitePageTitle(loaderData.title, loaderData.site.name);
    const description = metaDescription(loaderData.description, loaderData.title);
    return {
      meta: [
        { title },
        { name: "description", content: description },
        ...socialMeta({ title, description, url: absoluteUrl(origin, `/${loaderData.slug}`), type: "website", siteName: loaderData?.site.name, image: absoluteUrl(origin, defaultOgPath(loaderData?.site ?? {})) }),
      ],
      links: [{ rel: "canonical", href: absoluteUrl(origin, `/${loaderData.slug}`) }],
      scripts: [{ type: "application/ld+json", children: JSON.stringify(breadcrumbJsonLd({ origin, items: [{ name: "Home", path: "/" }, { name: loaderData.title, path: `/${loaderData.slug}` }] })) }],
    };
  },
  pendingComponent: PagePending,
  notFoundComponent: NotFoundState,
  component: PageRoute,
});

function PageRoute() {
  const data = Route.useLoaderData();
  return <StaticPage page={data} />;
}
