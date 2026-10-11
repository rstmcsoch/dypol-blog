import { createFileRoute, Link } from "@tanstack/react-router";
import { CoverPlate } from "@/components/site/cover-plate";
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
  const { lead, band, index, meta, topics } = Route.useLoaderData();
  if (!lead) {
    return (
      <div className="page">
        <div className="container">
          <h1 className="page-title">{site.name}</h1>
          <p className="lede">{site.labels.emptyBody}</p>
        </div>
      </div>
    );
  }
  const leadMeta = meta[lead.id];
  return (
    <>
      <section className="lead-section">
        <div className="container lead-grid">
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
          <Link
            to="/articles/$slug"
            params={{ slug: lead.slug }}
            className="plate-link"
            aria-label={lead.title}
          >
            {lead.coverMediaId ? (
              <img className="article-cover" src={`/media/${lead.coverMediaId}`} alt="" />
            ) : (
              <CoverPlate
                motif={lead.motif}
                index={padIndex(leadMeta?.rank ?? 1)}
                category={leadMeta?.categoryLabel ?? ""}
              />
            )}
          </Link>
        </div>
      </section>
      {band.length > 0 ? (
        <section className="band" aria-labelledby="also-filed">
          <span className="grain-layer" aria-hidden="true" />
          <div className="container band-inner">
            <h2 id="also-filed" className="band-head">
              {site.labels.also}
            </h2>
            <ul className="band-grid">
              {band.map((article) => (
                <li key={article.id}>
                  <Link to="/articles/$slug" params={{ slug: article.slug }} className="band-link">
                    {meta[article.id]?.categoryLabel ? (
                      <span className="band-link__cat">{meta[article.id]?.categoryLabel}</span>
                    ) : null}
                    <span className="band-link__title">{article.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
      <section className="section" aria-labelledby="latest">
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
      <section className="section section--flush" aria-labelledby="topics">
        <div className="container">
          <div className="section-head">
            <h2 id="topics">{site.labels.topics}</h2>
          </div>
          <TopicGrid topics={topics} />
        </div>
      </section>
    </>
  );
}