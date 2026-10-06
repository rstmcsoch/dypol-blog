import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArticleBody } from "@/components/site/article-body";
import { CoverPlate } from "@/components/site/cover-plate";
import { IndexList } from "@/components/site/index-list";
import { NotFoundState, PagePending } from "@/components/site/states";
import { site } from "@/content/site";
import {
  getCategory,
  getPublishedBySlug,
  neighbors,
  rankOf,
  readingMinutes,
  relatedArticles,
  tagsFor,
} from "@/content/queries";
import { formatDate, padIndex } from "@/lib/format";

export const Route = createFileRoute("/articles/$slug")({
  loader: ({ params }) => {
    const article = getPublishedBySlug(params.slug);
    if (!article) throw notFound();
    return {
      article,
      category: getCategory(article.categoryId),
      tags: tagsFor(article),
      related: relatedArticles(article, 3),
      neighbors: neighbors(article),
      rank: rankOf(article.slug),
    };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const { article } = loaderData;
    const title = article.seoTitle ?? `${article.title} — ${site.name}`;
    const description = article.seoDescription ?? article.excerpt;
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: article.title,
      description,
      datePublished: article.publishedAt,
      dateModified: article.updatedAt,
      articleSection: loaderData.category?.label,
      publisher: { "@type": "Organization", name: site.publisher },
    };
    return {
      meta: [
        { title },
        { name: "description", content: description },
      ],
      links: [{ rel: "canonical", href: `/articles/${article.slug}` }],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify(jsonLd),
        },
      ],
    };
  },
  pendingComponent: PagePending,
  notFoundComponent: NotFoundState,
  component: ArticlePage,
});

function ArticlePage() {
  const { article, category, tags, related, neighbors: side, rank } = Route.useLoaderData();
  return (
    <article className="article">
      <div className="container">
        <header className="article-top">
          {category ? (
            <p className="article-kicker">
              <Link to="/topics/$slug" params={{ slug: category.slug }}>
                {category.label}
              </Link>
            </p>
          ) : null}
          <h1 className="article-title">{article.title}</h1>
          <p className="lede">{article.excerpt}</p>
          <p className="meta">
            {article.publishedAt ? <span>{formatDate(article.publishedAt)}</span> : null}
            <span>
              {readingMinutes(article)} {site.labels.minRead}
            </span>
          </p>
        </header>
        <div className="article-plate">
          <CoverPlate motif={article.motif} index={padIndex(rank)} category={category?.label ?? ""} />
        </div>
        <div className="article-layout">
          <ArticleBody blocks={article.blocks} />
          <aside className="article-aside">
            {tags.length > 0 ? (
              <ul className="tag-list" aria-label="Tags">
                {tags.map((tag) => (
                  <li key={tag.id}>{tag.label}</li>
                ))}
              </ul>
            ) : null}
          </aside>
        </div>
        {(side.newer || side.older) && (
          <nav className="neighbor-list" aria-label={site.labels.neighbors}>
            {side.newer ? (
              <Link to="/articles/$slug" params={{ slug: side.newer.slug }} className="neighbor">
                <span>{site.labels.newer}</span>
                <strong>{side.newer.title}</strong>
              </Link>
            ) : null}
            {side.older ? (
              <Link to="/articles/$slug" params={{ slug: side.older.slug }} className="neighbor">
                <span>{site.labels.older}</span>
                <strong>{side.older.title}</strong>
              </Link>
            ) : null}
          </nav>
        )}
        {related.length > 0 ? (
          <section className="section" aria-labelledby="continue">
            <h2 id="continue">{site.labels.related}</h2>
            <IndexList articles={related} />
          </section>
        ) : null}
      </div>
    </article>
  );
}
