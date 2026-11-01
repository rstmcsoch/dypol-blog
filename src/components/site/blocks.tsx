import { Link } from "@tanstack/react-router";
import type { Card, ResolvedBlock } from "@/content/blocks";
import type { SiteConfig } from "@/content/types";
import { formatDate, padIndex } from "@/lib/format";
import { Markdown } from "@/components/markdown";
import { Cover, hasCover } from "./cover";
import { ShareLinks } from "./share";
import { TopicGrid } from "./topic-grid";
import { thumbUrl } from "@/lib/media-url";
import { ArrowRight } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { AdSlot, useSlotActive } from "./ads";

/** Each card's OWN cover (16/9), or a clean fallback panel with its topic — never another article's image. */
function Thumb({ c, className = "story-card__img" }: { c: Card; className?: string }) {
  if (c.coverMediaId) return <img className={className} src={thumbUrl(c.coverMediaId, c.coverImage?.v)} style={c.coverImage?.c ? { backgroundColor: c.coverImage.c } : undefined} alt={c.coverAlt?.trim() ? c.coverAlt : c.title} loading="lazy" decoding="async" width={480} height={270} />;
  return (
    <span className={`${className} story-card__img--empty`} aria-hidden="true">
      {c.categoryLabel || c.title}
    </span>
  );
}

export function topicLine(c: Card): string {
  const labels = c.topicLabels.length ? c.topicLabels : c.categoryLabel ? [c.categoryLabel] : [];
  if (labels.length <= 2) return labels.join(" · ");
  return `${labels.slice(0, 2).join(" · ")} +${labels.length - 2}`;
}

function CardList({ cards, layout, minRead, adCell }: { cards: Card[]; layout: "list" | "grid" | "cards"; minRead: string; adCell?: ReactNode }) {
  if (layout === "list") {
    return (
      <ol className="index-list">
        {cards.map((c, i) => (
          <li key={c.id}>
            <Link to="/articles/$slug" params={{ slug: c.slug }} className="index-row">
              <span className="index-row__num">{padIndex(i + 1)}</span>
              {c.coverMediaId ? (
                <span className="index-row__thumb"><img src={thumbUrl(c.coverMediaId, c.coverImage?.v)} style={c.coverImage?.c ? { backgroundColor: c.coverImage.c } : undefined} alt={c.coverAlt?.trim() ? c.coverAlt : c.title} loading="lazy" decoding="async" width={480} height={360} /></span>
              ) : (
                <span className="index-row__thumb index-row__thumb--empty" aria-hidden="true">{c.categoryLabel}</span>
              )}
              <span className="index-row__main">
                <span className="index-row__title">{c.title}</span>
                <span className="index-row__excerpt">{c.excerpt}</span>
              </span>
              <span className="index-row__meta">
                {c.topicLabels.length ? <span>{topicLine(c)}</span> : null}
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
            <Thumb c={c} />
            {c.topicLabels.length ? <span className="story-card__cat">{topicLine(c)}</span> : null}
            <span className="story-card__title">{c.title}</span>
            {layout === "cards" ? <span className="story-card__excerpt">{c.excerpt}</span> : null}
            <span className="story-card__meta">
              {c.publishedAt ? formatDate(c.publishedAt) : ""} · {c.minutes} {minRead}
            </span>
          </Link>
        </li>
      ))}
      {adCell}
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
            {lead.topicLabels.length ? ` · ${topicLine(lead)}` : ""}
          </p>
          <h2 className="display">
            <Link to="/articles/$slug" params={{ slug: lead.slug }}>
              {lead.title}
            </Link>
          </h2>
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
            <Cover mediaId={lead.coverMediaId} image={lead.coverImage} alt={lead.coverAlt} fallback={fallback} motif={lead.motif} index={padIndex(lead.rank || 1)} category={lead.categoryLabel} title={lead.title} priority />
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function Kicker({ c }: { c: Card }) {
  return c.topicLabels.length ? <span className="story-card__cat">{topicLine(c)}</span> : null;
}

function Meta({ c, minRead }: { c: Card; minRead: string }) {
  return (
    <span className="story-card__meta">
      {c.publishedAt ? <time dateTime={c.publishedAt}>{formatDate(c.publishedAt)}</time> : null}
      {c.publishedAt ? " · " : ""}
      {c.minutes} {minRead}
    </span>
  );
}

function SectionHead({ id, title, children }: { id: string; title: string; children?: ReactNode }) {
  return (
    <div className="section-head">
      <h2 id={id}>{title}</h2>
      {children}
    </div>
  );
}

/** t96: "Latest" river (dated rows) with a numbered "Most read" rail, like Android Police / TechCrunch. */
function River({ r, site, id }: { r: ResolvedBlock; site: SiteConfig; id: string }) {
  const rail = r.rail ?? [];
  const railId = `${id}-rail`;
  const railAd = useSlotActive("H2");
  return (
    <section className="section river-section" aria-labelledby={id} data-block="river">
      <div className={rail.length ? "container river" : "container river river--solo"}>
        <div className="river__main">
          <SectionHead id={id} title={r.title}>
            <Link to="/articles" className="text-link">
              {site.labels.fullIndex}
            </Link>
          </SectionHead>
          <ol className="river__list">
            {r.cards.map((c, i) => (
              <Fragment key={c.id}>
              <li>
                <Link to="/articles/$slug" params={{ slug: c.slug }} className="river-row">
                  <span className="river-row__when">{c.publishedAt ? <time dateTime={c.publishedAt}>{formatDate(c.publishedAt)}</time> : null}</span>
                  <span className="river-row__main">
                    <Kicker c={c} />
                    <span className="river-row__title">{c.title}</span>
                    <span className="river-row__excerpt">{c.excerpt}</span>
                  </span>
                  <Thumb c={c} className="river-row__img" />
                </Link>
              </li>
              {i === 3 && r.cards.length > 4 ? <AdSlot id="H3" wrap="li" /> : null}
              </Fragment>
            ))}
          </ol>
        </div>
        {rail.length ? (
          <RailColumn ad={railAd}>
          <aside className="rail" aria-labelledby={railId}>
            <h2 id={railId} className="rail__head">
              {r.railTitle ?? site.labels.popular}
            </h2>
            <ol className="rail__list">
              {rail.map((c, i) => (
                <li key={c.id}>
                  <Link to="/articles/$slug" params={{ slug: c.slug }} className="rail-row">
                    <span className="rail-row__num grain" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span className="rail-row__title">{c.title}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </aside>
          </RailColumn>
        ) : null}
      </div>
    </section>
  );
}

/** t148: the rail and its ad (H2) stick together; without the ad the rail renders exactly as before. */
function RailColumn({ ad, children }: { ad: boolean; children: ReactNode }) {
  if (!ad) return <>{children}</>;
  return (
    <div className="rail-col">
      {children}
      <AdSlot id="H2" />
    </div>
  );
}

function TopicSide({ ad, children }: { ad: boolean; children: ReactNode }) {
  if (!ad) return <>{children}</>;
  return (
    <div className="topic-row__side">
      {children}
      <AdSlot id="H4" />
    </div>
  );
}

/** t96: one row per busy topic — a big story and three compact ones, then "More in …". */
function TopicRows({ r, site, id }: { r: ResolvedBlock; site: SiteConfig; id: string }) {
  const h4 = useSlotActive("H4");
  return (
    <section className="section topic-rows" aria-labelledby={id} data-block="topicRows">
      <div className="container">
        <p id={id} className="kicker topic-rows__kicker">
          {r.title}
        </p>
        {(r.rows ?? []).map((row, rowIndex) => {
          const [big, ...rest] = row.cards;
          const rowId = `${id}-${row.category.slug}`;
          return (
            <section key={row.category.id} className="topic-row" aria-labelledby={rowId}>
              <div className="topic-row__head">
                <h2 id={rowId}>
                  <Link to="/topics/$slug" params={{ slug: row.category.slug }}>
                    {row.category.label}
                  </Link>
                </h2>
                <Link to="/topics/$slug" params={{ slug: row.category.slug }} className="btn btn--accent btn--sm grain">
                  <span>{`${site.labels.moreIn} ${row.category.label}`}</span>
                  <span className="sr-only"> ({row.count})</span>
                  <ArrowRight aria-hidden="true" />
                </Link>
              </div>
              <div className="topic-row__grid">
                {big ? (
                  <Link to="/articles/$slug" params={{ slug: big.slug }} className="story-card topic-row__big">
                    <Thumb c={big} />
                    <span className="story-card__title">{big.title}</span>
                    <span className="story-card__excerpt">{big.excerpt}</span>
                    <Meta c={big} minRead={site.labels.minRead} />
                  </Link>
                ) : null}
                <TopicSide ad={rowIndex === 0 && h4}>
                <ul className="topic-row__list">
                  {rest.map((c) => (
                    <li key={c.id}>
                      <Link to="/articles/$slug" params={{ slug: c.slug }} className="mini-card">
                        <Thumb c={c} className="mini-card__img" />
                        <span className="mini-card__main">
                          <span className="mini-card__title">{c.title}</span>
                          <Meta c={c} minRead={site.labels.minRead} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                </TopicSide>
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

/** t96: shortest unseen stories as compact text cards with an orange reading-time badge. */
function QuickReads({ r, site, id }: { r: ResolvedBlock; site: SiteConfig; id: string }) {
  return (
    <section className="section quick-reads" aria-labelledby={id} data-block="quickReads">
      <div className="container">
        <SectionHead id={id} title={r.title} />
        <ul className="quick-grid">
          {r.cards.map((c) => (
            <li key={c.id}>
              <Link to="/articles/$slug" params={{ slug: c.slug }} className="quick-card">
                <span className="quick-card__time grain">
                  {c.minutes} {site.labels.minRead}
                </span>
                <Kicker c={c} />
                <span className="quick-card__title">{c.title}</span>
                <span className="quick-card__excerpt">{c.excerpt}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** t96: the rest of the archive as a grid, ending in a button to the full index. */
function MoreStories({ r, site, id }: { r: ResolvedBlock; site: SiteConfig; id: string }) {
  return (
    <section className="section more-stories" aria-labelledby={id} data-block="moreStories">
      <div className="container">
        <SectionHead id={id} title={r.title} />
        <CardList cards={r.cards} layout={r.block.layout} minRead={site.labels.minRead} adCell={r.block.layout === "list" ? undefined : <AdSlot id="H7" wrap="cell" />} />
        <p className="more-stories__foot">
          <Link to="/articles" className="btn btn--accent grain">
            {site.labels.fullIndex}
            <ArrowRight aria-hidden="true" />
          </Link>
        </p>
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
  return (
    <>
      <h1 className="sr-only">{site.name}</h1>
      {blocks.map((r, i) => {
        const id = `blk-${r.block.id}`;
        const t = r.block.type;
        if (t === "featured") return <Featured key={r.block.id} r={r} site={site} />;
        if (t === "river") return <River key={r.block.id} r={r} site={site} id={id} />;
        if (t === "topicRows") return <TopicRows key={r.block.id} r={r} site={site} id={id} />;
        if (t === "quickReads") {
          return (
            <Fragment key={r.block.id}>
              <AdSlot id="H5" wrap="container" />
              <QuickReads r={r} site={site} id={id} />
            </Fragment>
          );
        }
        if (t === "moreStories") return <MoreStories key={r.block.id} r={r} site={site} id={id} />;
        if (t === "also") {
          return (
            <Fragment key={r.block.id}>
            <section className="band grain" aria-labelledby={id} data-block={t}>
              <div className="container band-inner">
                <h2 id={id} className="band-head">
                  {r.title}
                </h2>
                <ul className="band-grid">
                  {r.cards.map((c) => (
                    <li key={c.id}>
                      <Link to="/articles/$slug" params={{ slug: c.slug }} className="band-link">
                        {c.topicLabels.length ? <span className="band-link__cat">{topicLine(c)}</span> : null}
                        <span className="band-link__title">{c.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
            <AdSlot id="H1" wrap="container" />
            </Fragment>
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
                  {t === "tags" && r.tags ? (
                    <ul className="tag-list">
                      {r.tags.map((tag) => (
                        <li key={tag.id}>{tag.label}</li>
                      ))}
                    </ul>
                  ) : null}
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
                  {r.cards.length > 0 ? <CardList cards={r.cards} layout={r.block.layout} minRead={site.labels.minRead} adCell={t === "related" && r.block.layout !== "list" ? <AdSlot id="H6" wrap="cell" /> : undefined} /> : null}
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
export function SidebarBlocks({ blocks, site, title, slug, adAfterRelated }: { blocks: ResolvedBlock[]; site: SiteConfig; title: string; slug: string; adAfterRelated?: ReactNode }) {
  const anchor = blocks.findIndex((r) => r.block.type === "related");
  const adAt = anchor >= 0 ? anchor : blocks.length - 1;
  return (
    <>
      {blocks.map((r, i) => (
        <Fragment key={r.block.id}>
          <SidebarBlock r={r} site={site} title={title} slug={slug} />
          {i === adAt ? adAfterRelated : null}
        </Fragment>
      ))}
    </>
  );
}

function SidebarBlock({ r, site, title, slug }: { r: ResolvedBlock; site: SiteConfig; title: string; slug: string }) {
  return (
    <>
      {[r].map((r) => {
        const t = r.block.type;
        if (t === "share") {
          return <ShareLinks key={r.block.id} title={title} path={`/articles/${slug}`} label={r.title} copyLabel={site.labels.copyLink} copiedLabel={site.labels.linkCopied} buttons={site.share?.buttons} />;
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
                      {c.coverMediaId ? <img className="aside-thumb" src={thumbUrl(c.coverMediaId, c.coverImage?.v)} style={c.coverImage?.c ? { backgroundColor: c.coverImage.c } : undefined} alt={c.coverAlt?.trim() ? c.coverAlt : c.title} loading="lazy" decoding="async" width={480} height={360} /> : null}
                      <span className="aside-title">{c.title}</span>
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
