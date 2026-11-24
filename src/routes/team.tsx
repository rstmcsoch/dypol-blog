import { createFileRoute } from "@tanstack/react-router";
import { PagePending } from "@/components/site/states";
import { TeamPage } from "@/components/site/team-page";
import { AdPage } from "@/components/site/ads";
import { getTeam } from "@/content/public-api";
import { defaultOgPath, absoluteUrl, breadcrumbJsonLd, metaDescription, sitePageTitle, socialMeta } from "@/lib/seo";

const TEAM_PAGE = { type: "about" as const };

export const Route = createFileRoute("/team")({
  loader: () => getTeam(),
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: sitePageTitle("Editorial Team") }] };
    const origin = loaderData.origin ?? "";
    const title = sitePageTitle("Editorial Team", loaderData.site.name);
    const description = metaDescription(
      "Meet the DYPOL Blog editorial team — the editors and writers who research, report, edit and publish every story.",
      title,
    );
    return {
      meta: [
        { title },
        { name: "description", content: description },
        ...socialMeta({
          title,
          description,
          url: absoluteUrl(origin, "/team"),
          type: "website",
          siteName: loaderData.site.name,
          image: absoluteUrl(origin, defaultOgPath(loaderData.site ?? {})),
        }),
      ],
      links: [{ rel: "canonical", href: absoluteUrl(origin, "/team") }],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify(
            breadcrumbJsonLd({
              origin,
              items: [
                { name: "Home", path: "/" },
                { name: "Editorial Team", path: "/team" },
              ],
            }),
          ),
        },
      ],
    };
  },
  pendingComponent: PagePending,
  component: TeamRoute,
});

function TeamRoute() {
  const { team } = Route.useLoaderData();
  return (
    <AdPage page={TEAM_PAGE}>
      <TeamPage team={team} />
    </AdPage>
  );
}
