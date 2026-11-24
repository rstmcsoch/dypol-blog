import "@/styles-about-team.css";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { NotFoundState, PagePending } from "@/components/site/states";
import { StaticPage } from "@/components/site/static-page";
import { AdPage } from "@/components/site/ads";

const ABOUT_PAGE = { type: "about" as const };
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
  return (
    <AdPage page={ABOUT_PAGE}>
      <StaticPage page={data} />
      <section className="page" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="static-column">
            <Link to="/team" className="about-team-cta" aria-label="Meet the DYPOL Blog editorial team">
              <div className="about-team-cta__copy">
                <p className="kicker">The newsroom</p>
                <p className="about-team-cta__title">Meet the editorial team</p>
                <p className="about-team-cta__lede">The editors and writers behind DYPOL Blog — the people who research, report, edit and publish every story.</p>
              </div>
              <span className="about-team-cta__action" aria-hidden="true">
                View team <ArrowRight size={18} strokeWidth={2.5} />
              </span>
            </Link>
          </div>
        </div>
      </section>
    </AdPage>
  );
}
