import { createFileRoute, Link } from "@tanstack/react-router";
import { Cover, hasCover } from "@/components/site/cover";
import { IndexList } from "@/components/site/index-list";
import { PagePending } from "@/components/site/states";
import { TopicGrid } from "@/components/site/topic-grid";
import { useSite } from "@/components/site/use-site";
import { getHome } from "@/content/public-api";
import { site as fallbackSite } from "@/content/site";
import { formatDate, padIndex } from "@/lib/format";

export const Route = createFileRoute("/")({
  loader: () => getHome(),
  head: () => ({
    meta: [
      { title: fallbackSite.title },
      { name: "description", content: fallbackSite.description },
    ],
    links: [{ rel: "canonical", href: "/" }],
  }),
  pendingComponent: PagePending,
  component: Home,
});

function Home() {
  const site = useSite();
  const { lead, band, index, meta, topics, empty } = Route.useLoaderData();
  if (empty) {
    return (
      <div className="page">
        <div className="container">
          <h1 className="page-title">{site.name}</h1>
          <p className="lede">{site.labels.emptyBody}</p>
        </div>
      </div>
    );
  }
  const leadMeta = lead ? meta[lead.id] : undefined;
  const fallback = site.appearance.coverFallback;
  const featured = lead ? (
    <section className="lead-section" key="featured">
      <div className={hasCover(lead.coverMediaId, fallback) ? "container lead-grid" : "container lead-grid lead-grid--solo"}>
        <div className="lead-copy">
          <p className="kicker">
            {site.labels.featured}
            {leadMeta?.categoryLabel ? ` · ${leadMeta.categoryLabel}` : ""}
          </p>
          <h1 className="display">
            <Link to="/articles/$slug" params={{ slug: lead.slug }}>
              {lead.title}
            </Link>
          </h1>
          <p className="lede">{lead.excerpt}</p>
          <p className="meta">
            {lead.publishedAt ? <span>{formatDate(lead.publishedAt)}</span> : null}
            <span>
              {leadMeta?.minutes ?? 1} {site.labels.minRead}
            </span>
          </p>
          <Link to="/articles/$slug" params={{ slug: lead.slug }} className="btn">
            {site.labels.read}
          </Link>
        </div>
        {hasCover(lead.coverMediaId, fallback) ? (
          <Link to="/articles/$slug" params={{ slug: lead.slug }} className="plate-link" aria-label={lead.title}>
            <Cover
              mediaId={lead.coverMediaId}
              fallback={fallback}
              motif={lead.motif}
              index={padIndex(leadMeta?.rank ?? 1)}
              category={leadMeta?.categoryLabel ?? ""}
              title={lead.title}
            />
          </Link>
        ) : null}
      </div>
    </section>
  ) : null;
  const also =
    band.length > 0 ? (
      <section className="band" aria-labelledby="also-filed" key="also">
        <span className="grain-layer" aria-hidden="true" />
        <div className="container band-inner">
          <h2 id="also-filed" className="band-head">
            {site.labels.also}
          </h2>
          <ul className="band-grid">
            {band.map((article) => (
              <li key={article.id}>
                <Link to="/articles/$slug" params={{ slug: article.slug }} className="band-link">
                  {meta[article.id]?.categoryLabel ? <span className="band-link__cat">{meta[article.id]?.categoryLabel}</span> : null}
                  <span className="band-link__title">{article.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    ) : null;
  const latest =
    index.length > 0 ? (
      <section className="section" aria-labelledby="latest" key="latest">
        <div className="container">
          <div className="section-head">
            <h2 id="latest">{site.labels.latest}</h2>
            <Link to="/articles" className="text-link">
              {site.labels.fullIndex}
            </Link>
          </div>
          <IndexList articles={index} meta={meta} minRead={site.labels.minRead} />
        </div>
      </section>
    ) : null;
  const topicGrid =
    topics.length > 0 ? (
      <section className="section section--flush" aria-labelledby="topics" key="topics">
        <div className="container">
          <div className="section-head">
            <h2 id="topics">{site.labels.topics}</h2>
          </div>
          <TopicGrid topics={topics} />
        </div>
      </section>
    ) : null;
  const byId = { featured, also, latest, topics: topicGrid };
  return (
    <>
      {featured ? null : <h1 className="sr-only">{site.name}</h1>}
      {site.home.sections.map((section) => (section.enabled ? byId[section.id] : null))}
    </>
  );
}
