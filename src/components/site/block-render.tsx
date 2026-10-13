import { Link } from "@tanstack/react-router";
import type { ResolvedBlock } from "@/content/layout.server";
import type { SelectedArticle } from "@/content/repository.server";
import type { Category, SiteConfig, Tag } from "@/content/types";
import { formatDate, padIndex } from "@/lib/format";
import { Cover, hasCover } from "./cover";
import { ShareLinks } from "./share";

/**
 * Renders resolved homepage/sidebar blocks with the site's existing visual
 * language. Every branch returns plain markup; nothing here reads storage or
 * decides what should appear (that is the layout layer's job).
 */

function articleHref(article: SelectedArticle) {
  return { to: "/articles/$slug" as const, params: { slug: article.slug } };
}

export function ArticleRows({ articles, minRead }: { articles: SelectedArticle[]; minRead: string }) {
  return (
    <ol className="index-list">
      {articles.map((article) => (
        <li key={article.id}>
          <Link {...articleHref(article)} className="index-row">
            <span className="index-row__num">{padIndex(article.rank)}</span>
            <span className="index-row__main">
              <span className="index-row__title">{article.title}</span>
              {article.excerpt ? <span className="index-row__excerpt">{article.excerpt}</span> : null}
            </span>
            <span className="index-row__meta">
              {article.categoryLabel ? <span>{article.categoryLabel}</span> : null}
              {article.publishedAt ? <span>{formatDate(article.publishedAt)}</span> : null}
              <span>
                {article.minutes} {minRead}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

function StoryCards({ articles, block, minRead }: { articles: SelectedArticle[]; block: Extract<ResolvedBlock, { kind: "articleList" }>["block"]; minRead: string }) {
  const config = block;
  return (
    <ul className="stories-grid" data-columns={config.columns}>
      {articles.map((article) => (
        <li key={article.id}>
          <Link {...articleHref(article)} className="story-card">
            {config.showImages && hasCover(article.coverMediaId, "plate") ? (
              <span className="story-card__plate">
                <Cover
                  mediaId={article.coverMediaId}
                  fallback="plate"
                  motif={article.motif}
                  index={padIndex(article.rank)}
                  category={article.categoryLabel}
                  title={article.title}
                />
              </span>
            ) : null}
            <span className="story-card__title">{article.title}</span>
            {config.showExcerpt && article.excerpt ? <span className="story-card__excerpt">{article.excerpt}</span> : null}
            {config.showMeta ? (
              <span className="story-card__meta">
                {article.categoryLabel ? <span>{article.categoryLabel}</span> : null}
                {article.publishedAt ? <span>{formatDate(article.publishedAt)}</span> : null}
                <span>
                  {article.minutes} {minRead}
                </span>
              </span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

type HeadingBlock = { id: string; heading: string; description: string; viewAll: { label: string; href: string } | null };

function Heading({ block }: { block: HeadingBlock }) {
  if (!block.heading && !block.description && !block.viewAll) return null;
  return (
    <div className="section-head">
      <div>
        {block.heading ? <h2 id={`block-${block.id}`}>{block.heading}</h2> : null}
        {block.description ? <p className="section-note">{block.description}</p> : null}
      </div>
      {block.viewAll ? (
        block.viewAll.href.startsWith("/") ? (
          <a className="text-link" href={block.viewAll.href}>
            {block.viewAll.label}
          </a>
        ) : (
          <a className="text-link" href={block.viewAll.href} rel="noreferrer">
            {block.viewAll.label}
          </a>
        )
      ) : null}
    </div>
  );
}

function topicHref(topic: Category) {
  return { to: "/topics/$slug" as const, params: { slug: topic.slug } };
}

function topicLabel(category: Category) {
  return category.label;
}

/** One resolved block on the homepage. */
export function HomeBlock({ resolved, site }: { resolved: ResolvedBlock; site: SiteConfig }) {
  const spacing = resolved.block.spacing;
  const className = spacing === "compact" ? "section section--tight" : spacing === "roomy" ? "section section--roomy" : "section";

  switch (resolved.kind) {
    case "hero": {
      const lead = resolved.article;
      if (!lead) return null;
      const fallback = site.appearance.coverFallback;
      const showPlate = resolved.block.showCover && hasCover(lead.coverMediaId, fallback);
      return (
        <section className="lead-section" aria-labelledby={`block-${resolved.block.id}`}>
          {resolved.block.kicker || resolved.block.heading ? (
            <div className="container">
              <p className="kicker">
                {resolved.block.kicker}
                {resolved.block.kicker && resolved.block.heading ? " · " : ""}
                {resolved.block.heading}
              </p>
            </div>
          ) : null}
          <div className={showPlate ? "container lead-grid" : "container lead-grid lead-grid--solo"}>
            <div className="lead-copy">
              <p className="kicker">
                {resolved.block.kicker ? resolved.block.kicker : site.labels.featured}
                {lead.categoryLabel ? ` · ${lead.categoryLabel}` : ""}
              </p>
              <h1 className="display" id={`block-${resolved.block.id}`}>
                <Link {...articleHref(lead)}>{lead.title}</Link>
              </h1>
              {resolved.block.showExcerpt && lead.excerpt ? <p className="lede">{lead.excerpt}</p> : null}
              <p className="meta">
                {lead.publishedAt ? <span>{formatDate(lead.publishedAt)}</span> : null}
                <span>
                  {lead.minutes} {site.labels.minRead}
                </span>
              </p>
              <Link {...articleHref(lead)} className="btn">
                {site.labels.read}
              </Link>
            </div>
            {showPlate ? (
              <Link {...articleHref(lead)} className="plate-link" aria-label={lead.title}>
                <Cover
                  mediaId={lead.coverMediaId}
                  fallback={fallback}
                  motif={lead.motif}
                  index={padIndex(lead.rank)}
                  category={lead.categoryLabel}
                  title={lead.title}
                />
              </Link>
            ) : null}
          </div>
        </section>
      );
    }
    case "articleList": {
      const block = resolved.block;
      const empty = resolved.articles.length === 0;
      return (
        <section className={className} aria-labelledby={block.heading ? `block-${block.id}` : undefined}>
          <div className="container">
            <Heading block={block} />
            {empty ? (
              <p className="lede">{block.description || "Nothing published in this block yet."}</p>
            ) : block.style === "grid" ? (
              <StoryCards articles={resolved.articles} block={block} minRead={site.labels.minRead} />
            ) : block.style === "list" ? (
              <ul className="story-list">
                {resolved.articles.map((article) => (
                  <li key={article.id}>
                    <Link {...articleHref(article)}>{article.title}</Link>
                    {block.showMeta ? <span className="story-list__meta">{article.categoryLabel}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <ArticleRows articles={resolved.articles} minRead={site.labels.minRead} />
            )}
          </div>
        </section>
      );
    }
    case "categories": {
      const block = resolved.block;
      return (
        <section className={className} aria-labelledby={`block-${block.id}`}>
          <div className="container">
            <Heading block={block} />
            {block.style === "list" ? (
              <ul className="topic-list">
                {resolved.topics.map(({ category, count }) => (
                  <li key={category.id}>
                    <Link {...topicHref(category)}>{topicLabel(category)}</Link>
                    {block.showCounts ? <span className="topic-list__count">{count}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="topic-grid">
                {resolved.topics.map(({ category, count }) => (
                  <li key={category.id}>
                    <Link {...topicHref(category)} className="topic-card">
                      {block.showCounts ? <span className="topic-card__count">{padIndex(count)}</span> : null}
                      <span className="topic-card__label">{category.label}</span>
                      <span className="topic-card__desc">{category.description}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      );
    }
    case "tags": {
      const block = resolved.block;
      return (
        <section className={className} aria-labelledby={`block-${block.id}`}>
          <div className="container">
            <Heading block={block} />
            <ul className="tag-list">
              {resolved.tags.map(({ tag, count }) => (
                <li key={tag.id}>
                  {tag.label}
                  <span className="tag-list__count">{count}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      );
    }
    case "richText": {
      const block = resolved.block;
      return (
        <section className={className} aria-labelledby={`block-${block.id}`}>
          <div className="container prose-block">
            <Heading block={block} />
            {block.body.split(/\n{2,}/).map((paragraph, index) => (
              <p key={index}>{paragraph.trim()}</p>
            ))}
          </div>
        </section>
      );
    }
    case "announcement": {
      const block = resolved.block;
      const isLink = block.href.length > 0;
      const tone = block.tone === "accent" ? "notice notice--accent" : "notice";
      return (
        <section className={className}>
          <div className="container">
            <div className={tone}>
              {block.heading ? <p className="notice__title">{block.heading}</p> : null}
              {block.description ? <p className="notice__body">{block.description}</p> : null}
              {isLink && block.linkLabel ? (
                block.href.startsWith("/") ? (
                  <a className="btn" href={block.href}>
                    {block.linkLabel}
                  </a>
                ) : (
                  <a className="btn" href={block.href} rel="noreferrer">
                    {block.linkLabel}
                  </a>
                )
              ) : null}
            </div>
          </div>
        </section>
      );
    }
    default:
      return null;
  }
}

/** One resolved block in an article's sidebar. */
export function SidebarBlock({ resolved, site }: { resolved: ResolvedBlock; site: SiteConfig }) {
  const heading = resolved.block.heading;
  switch (resolved.kind) {
    case "articleTags":
      return (
        <div className="aside-block">
          {heading ? <h2 className="aside-head">{heading}</h2> : null}
          <ul className="tag-list">
            {resolved.tags.map((tag: Tag) => (
              <li key={tag.id}>{tag.label}</li>
            ))}
          </ul>
        </div>
      );
    case "articleList":
      return (
        <div className="aside-block">
          {heading ? <h2 className="aside-head">{heading}</h2> : null}
          {resolved.articles.length === 0 ? (
            <p className="aside-note">Nothing here yet.</p>
          ) : (
            <ul className="aside-list">
              {resolved.articles.map((article) => (
                <li key={article.id}>
                  <Link {...articleHref(article)}>{article.title}</Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    case "categories":
      return (
        <div className="aside-block">
          {heading ? <h2 className="aside-head">{heading}</h2> : null}
          <ul className="aside-list">
            {resolved.topics.map(({ category, count }) => (
              <li key={category.id}>
                <Link {...topicHref(category)}>
                  {category.label}
                  {resolved.block.showCounts ? ` (${count})` : ""}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      );
    case "tags":
      return (
        <div className="aside-block">
          {heading ? <h2 className="aside-head">{heading}</h2> : null}
          <ul className="tag-list">
            {resolved.tags.map(({ tag }) => (
              <li key={tag.id}>{tag.label}</li>
            ))}
          </ul>
        </div>
      );
    case "richText":
      return (
        <div className="aside-block">
          {heading ? <h2 className="aside-head">{heading}</h2> : null}
          {resolved.block.body.split(/\n{2,}/).map((paragraph, index) => (
            <p className="aside-rich" key={index}>
              {paragraph.trim()}
            </p>
          ))}
        </div>
      );
    case "announcement":
      return (
        <div className="aside-block">
          {heading ? <h2 className="aside-head">{heading}</h2> : null}
          <div className="aside-notice">
            {resolved.block.description ? <p>{resolved.block.description}</p> : null}
            {resolved.block.href && resolved.block.linkLabel ? (
              <a className="text-link" href={resolved.block.href} rel="noreferrer">
                {resolved.block.linkLabel}
              </a>
            ) : null}
          </div>
        </div>
      );
    case "share":
      return (
        <ShareLinks
          key="share"
          title={resolved.shareTitle ?? ""}
          path={resolved.sharePath ?? "/"}
          label={heading || site.labels.share}
          copyLabel={site.labels.copyLink}
          copiedLabel={site.labels.linkCopied}
        />
      );
    default:
      return null;
  }
}
