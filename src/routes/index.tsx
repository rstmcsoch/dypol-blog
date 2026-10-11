import { createFileRoute, Link } from "@tanstack/react-router";
import { CoverPlate } from "@/components/site/cover-plate";
import { IndexList } from "@/components/site/index-list";
import { PagePending } from "@/components/site/states";
import { TopicGrid } from "@/components/site/topic-grid";
import { site } from "@/content/site";
import {
  featuredArticle,
  getCategory,
  listPublished,
  rankOf,
  readingMinutes,
} from "@/content/queries";
import { formatDate, padIndex } from "@/lib/format";

export const Route = createFileRoute("/")({
  loader: () => {
    const published = listPublished();
    const lead = featuredArticle();
    const rest = published.filter((article) => article.id !== lead?.id);
    return {
      lead,
      band: rest.slice(0, 3),
      index: rest.slice(3),
    };
  },
  head: () => ({
    meta: [
      { title: site.title },
      { name: "description", content: site.description },
    ],
    links: [{ rel: "canonical", href: "/" }],
  }),
  pendingComponent: PagePending,
  component: Home,
});

function Home() {
  const { lead, band, index } = Route.useLoaderData();
  if (!lead) {
    return (
      <div className="page">
        <div className="container">
          <h1 className="page-title">{site.name}</h1>
        </div>
      </div>
    );
  }
  const category = getCategory(lead.categoryId);
  return (
    <>
      <section className="lead-section">
        <div className="container lead-grid">
          <div className="lead-copy">
            <p className="kicker">
              {site.labels.featured}
              {category ? ` · ${category.label}` : ""}
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
                {readingMinutes(lead)} {site.labels.minRead}
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
            <CoverPlate
              motif={lead.motif}
              index={padIndex(rankOf(lead.slug))}
              category={category?.label ?? ""}
            />
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
              {band.map((article) => {
                const topic = getCategory(article.categoryId);
                return (
                  <li key={article.id}>
                    <Link to="/articles/$slug" params={{ slug: article.slug }} className="band-link">
                      {topic ? <span className="band-link__cat">{topic.label}</span> : null}
                      <span className="band-link__title">{article.title}</span>
                    </Link>
                  </li>
                );
              })}
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
          <IndexList articles={index} />
        </div>
      </section>
      <section className="section section--flush" aria-labelledby="topics">
        <div className="container">
          <div className="section-head">
            <h2 id="topics">{site.labels.topics}</h2>
          </div>
          <TopicGrid />
        </div>
      </section>
    </>
  );
}
