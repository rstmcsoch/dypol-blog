import { Link } from "@tanstack/react-router";
import type { Card, ResolvedBlock } from "@/content/blocks";
import type { SiteConfig } from "@/content/types";
import { formatDate, padIndex } from "@/lib/format";
import { Markdown } from "@/components/markdown";
import { Cover, hasCover } from "./cover";
import { ShareLinks } from "./share";
import { TopicGrid } from "./topic-grid";

function CardList({ cards, layout, minRead }: { cards: Card[]; layout: "list" | "grid" | "cards"; minRead: string }) {
  if (layout === "list") {
    return (
      <ol className="index-list">
        {cards.map((c) => (
          <li key={c.id}>
            <Link to="/articles/$slug" params={{ slug: c.slug }} className="index-row">
              <span className="index-row__num">{padIndex(c.rank)}</span>
              <span className="index-row__main">
                <span className="index-row__title">{c.title}</span>
                <span className="index-row__excerpt">{c.excerpt}</span>
              </span>
              <span className="index-row__meta">
                {c.categoryLabel ? <span>{c.categoryLabel}</span> : null}
                {c.publishedAt ? <span>{formatDate(c.publishedAt)}</span> : null}
                <span>
                  {c.minutes} {minRead}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <ul className={layout === "grid" ? "card-grid" : "card-grid card-grid--cards"}>
      {cards.map((c) => (
        <li key={c.id}>
          <Link to="/articles/$slug" params={{ slug: c.slug }} className="story-card">
            {layout === "cards" ? (
              c.coverMediaId ? (
                <img className="story-card__img" src={`/media/${c.coverMediaId}`} alt="" loading="lazy" />
              ) : (
                <span className="story-card__img story-card__img--empty" aria-hidden="true">
                  {c.categoryLabel}
                </span>
              )
            ) : null}
            {c.categoryLabel ? <span className="story-card__cat">{c.categoryLabel}</span> : null}
            <span className="story-card__title">{c.title}</span>
            {layout === "cards" ? <span className="story-card__excerpt">{c.excerpt}</span> : null}
            <span className="story-card__meta">
              {c.publishedAt ? formatDate(c.publishedAt) : ""} · {c.minutes} {minRead}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Featured({ r, site }: { r: ResolvedBlock; site: SiteConfig }) {
  const lead = r.cards[0];
  if (!lead) return null;
  const fallback = site.appearance.coverFallback;
  const cover = hasCover(lead.coverMediaId, fallback);
  return (
    <section className="lead-section" data-block={r.block.type}>
      <div className={cover ? "container lead-grid" : "container lead-grid lead-grid--solo"}>
        <div className="lead-copy">
          <p className="kicker">
            {r.title}
            {lead.categoryLabel ? ` · ${lead.categoryLabel}` : ""}
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
              {lead.minutes} {site.labels.minRead}
            </span>
          </p>
          <Link to="/articles/$slug" params={{ slug: lead.slug }} className="btn">
            {site.labels.read}
          </Link>
        </div>
        {cover ? (
          <Link to="/articles/$slug" params={{ slug: lead.slug }} className="plate-link" aria-label={lead.title}>
            <Cover mediaId={lead.coverMediaId} fallback={fallback} motif={lead.motif} index={padIndex(lead.rank || 1)} category={lead.categoryLabel} title={lead.title} />
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function Cta({ r }: { r: ResolvedBlock }) {
  const { block } = r;
  const external = /^https?:/.test(block.ctaHref);
  return (
    <div className="cta-block">
      {r.title ? <h2>{r.title}</h2> : null}
      {block.body ? <Markdown source={block.body} /> : null}
      <a className="btn" href={block.ctaHref} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
        {block.ctaLabel}
      </a>
    </div>
  );
}

/** Homepage blocks in the owner's order. */
export function HomeBlocks({ blocks, site }: { blocks: ResolvedBlock[]; site: SiteConfig }) {
  const hasH1 = blocks.some((r) => r.block.type === "featured");
  return (
    <>
      {hasH1 ? null : <h1 className="sr-only">{site.name}</h1>}
      {blocks.map((r, i) => {
        const id = `blk-${r.block.id}`;
        const t = r.block.type;
        if (t === "featured") return <Featured key={r.block.id} r={r} site={site} />;
        if (t === "also") {
          return (
            <section key={r.block.id} className="band" aria-labelledby={id} data-block={t}>
              <span className="grain-layer" aria-hidden="true" />
              <div className="container band-inner">
                <h2 id={id} className="band-head">
                  {r.title}
                </h2>
                <ul className="band-grid">
                  {r.cards.map((c) => (
                    <li key={c.id}>
                      <Link to="/articles/$slug" params={{ slug: c.slug }} className="band-link">
                        {c.categoryLabel ? <span className="band-link__cat">{c.categoryLabel}</span> : null}
                        <span className="band-link__title">{c.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          );
        }
        return (
          <section key={r.block.id} className={i === blocks.length - 1 ? "section section--flush" : "section"} aria-labelledby={id} data-block={t}>
            <div className="container">
              {t === "cta" ? (
                <Cta r={r} />
              ) : (
                <>
                  {r.title ? (
                    <div className="section-head">
                      <h2 id={id}>{r.title}</h2>
                      {t === "latest" ? (
                        <Link to="/articles" className="text-link">
                          {site.labels.fullIndex}
                        </Link>
                      ) : null}
                    </div>
                  ) : null}
                  {t === "topics" && r.topics ? <TopicGrid topics={r.topics} /> : null}
                  {t === "text" ? (
                    <div className="text-block">
                      <Markdown source={r.block.body} />
                    </div>
                  ) : null}
                  {t === "ticker" && r.ticker ? (
                    <ul className="ticker-block">
                      {r.ticker.map((item) => (
                        <li key={item.id}>
                          {item.slug ? (
                            <Link to="/articles/$slug" params={{ slug: item.slug }}>
                              {item.title}
                            </Link>
                          ) : item.href ? (
                            <a href={item.href}>{item.title}</a>
                          ) : (
                            item.title
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {r.cards.length > 0 ? <CardList cards={r.cards} layout={r.block.layout} minRead={site.labels.minRead} /> : null}
                </>
              )}
            </div>
          </section>
        );
      })}
    </>
  );
}

/** Article sidebar blocks (always compact lists). */
export function SidebarBlocks({ blocks, site, title, slug }: { blocks: ResolvedBlock[]; site: SiteConfig; title: string; slug: string }) {
  return (
    <>
      {blocks.map((r) => {
        const t = r.block.type;
        if (t === "share") {
          return <ShareLinks key={r.block.id} title={title} path={`/articles/${slug}`} label={r.title} copyLabel={site.labels.copyLink} copiedLabel={site.labels.linkCopied} />;
        }
        return (
          <div className="aside-block" key={r.block.id} data-block={t}>
            {r.title ? <h2 className="aside-head">{r.title}</h2> : null}
            {t === "tags" && r.tags ? (
              <ul className="tag-list">
                {r.tags.map((tag) => (
                  <li key={tag.id}>{tag.label}</li>
                ))}
              </ul>
            ) : null}
            {t === "text" ? <Markdown source={r.block.body} /> : null}
            {t === "cta" ? (
              <>
                {r.block.body ? <Markdown source={r.block.body} /> : null}
                <a className="btn" href={r.block.ctaHref}>
                  {r.block.ctaLabel}
                </a>
              </>
            ) : null}
            {r.cards.length > 0 ? (
              <ul className="aside-list">
                {r.cards.map((c) => (
                  <li key={c.id}>
                    <Link to="/articles/$slug" params={{ slug: c.slug }}>
                      {c.title}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
