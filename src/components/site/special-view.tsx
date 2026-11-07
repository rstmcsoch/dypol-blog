import { Fragment, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { ArticleBlock, Article, Category, SiteConfig, Tag } from "@/content/types";
import type { SpecialBlock, SpecialResource, SpecialSource, TocEntry } from "@/lib/special/body";
import { headingId } from "@/lib/special/body";
import { chartSvg } from "@/lib/special/chart";
import { renderInline } from "@/components/markdown";
import { formatDate, isMeaningfullyUpdated } from "@/lib/format";
import { readingMinutes } from "@/content/present";
import { mediaUrl, thumbUrl } from "@/lib/media-url";
import { ProseBlocks } from "./article-body";
import { ReadingProgress } from "./reading-aids";
import { ShareLinks } from "./share";
import { AdSlot, SponsoredBy } from "./ads";

export type SpecialRelated = { id: string; slug: string; title: string; excerpt: string; publishedAt: string | null; coverMediaId: string | null; coverAlt: string | null; wordCount: number };
export type SpecialViewBody = { blocks: SpecialBlock[]; sources: SpecialSource[]; resources: SpecialResource[]; coverCredit: string | null; toc: TocEntry[]; version: number };

const PROVIDER: Record<SpecialResource["provider"], string> = {
  link: "Link",
  "google-drive": "Google Drive",
  onedrive: "OneDrive",
  dropbox: "Dropbox",
  "proton-drive": "Proton Drive",
};

function fileSize(n?: number) {
  if (!n) return "";
  return n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
}

/** Writer H1/H2/H3 render as h2/h3/h4: the page title is the only h1. Ids match specialToc(). */
function SpecialBlocks({ blocks, slug }: { blocks: SpecialBlock[]; slug: string }) {
  const seen = new Map<string, number>();
  const out: React.ReactNode[] = [];
  let prose: ArticleBlock[] = [];
  const flush = (k: string) => {
    if (prose.length) out.push(<ProseBlocks key={`p-${k}`} blocks={prose} />);
    prose = [];
  };
  blocks.forEach((b, i) => {
    if (b.type === "heading") {
      flush(String(i));
      const base = headingId(b.text) || "section";
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      const id = n > 1 ? `${base}-${n}` : base;
      const Tag = b.level === 1 ? "h2" : b.level === 2 ? "h3" : "h4";
      out.push(<Tag key={`h-${i}`} id={id} className={`spx-h spx-h--${b.level}`}>{renderInline(b.text, `h-${i}`)}</Tag>);
      return;
    }
    if (b.type === "image") {
      flush(String(i));
      out.push(
        <figure key={`i-${i}`} className="spx-figure">
          <img src={mediaUrl(b.mediaId)} alt={b.alt} loading="lazy" decoding="async" width={b.width || 1280} height={b.height || 720} />
          {b.caption || b.credit ? (
            <figcaption>
              {b.caption ? <span>{renderInline(b.caption, `ic-${i}`)}</span> : null}
              {b.credit ? <span className="spx-credit">{renderInline(b.credit, `icr-${i}`)}</span> : null}
            </figcaption>
          ) : null}
        </figure>,
      );
      return;
    }
    if (b.type === "chart") {
      flush(String(i));
      out.push(
        <figure key={`c-${i}`} className="spx-figure spx-chart">
          <div className="spx-chart__svg" role="img" aria-label={b.title} dangerouslySetInnerHTML={{ __html: chartSvg(b) }} />
          <figcaption>
            <span>{b.caption ? renderInline(b.caption, `cc-${i}`) : b.title}</span>
            <details className="spx-chart__data">
              <summary>View the data</summary>
              <div className="spx-table-wrap">
                <table>
                  <thead><tr><th scope="col">Label</th>{b.data.series.map((s) => <th scope="col" key={s.name}>{s.name}</th>)}</tr></thead>
                  <tbody>
                    {b.data.labels.map((l, r) => (
                      <tr key={`${l}-${r}`}><th scope="row">{l}</th>{b.data.series.map((s) => <td key={s.name}>{s.values[r]}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {slug ? <a href={`/special-charts/${slug}/${b.chartId}`} rel="nofollow">Download chart (SVG)</a> : null}
            </details>
          </figcaption>
        </figure>,
      );
      return;
    }
    if (b.type === "table") {
      flush(String(i));
      out.push(
        <figure key={`t-${i}`} className="spx-figure spx-tablefig">
          <ProseBlocks blocks={[{ type: "table", headers: b.headers, rows: b.rows, ...(b.align ? { align: b.align.map((a) => a || undefined) as ("left" | "center" | "right")[] } : {}) } as ArticleBlock]} />
          {b.caption ? <figcaption>{renderInline(b.caption, `tc-${i}`)}</figcaption> : null}
        </figure>,
      );
      return;
    }
    prose.push(b as ArticleBlock);
  });
  flush("end");
  return <>{out}</>;
}

function SpecialToc({ entries }: { entries: TocEntry[] }) {
  const [open, setOpen] = useState(false);
  if (entries.length < 2) return null;
  return (
    <nav className={open ? "spx-toc is-open" : "spx-toc"} aria-label="Contents">
      <button type="button" className="spx-toc__toggle" aria-expanded={open} aria-controls="spx-toc-list" onClick={() => setOpen((v) => !v)}>
        <span>Contents</span>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      <p className="spx-toc__title">Contents</p>
      <ol id="spx-toc-list" className="spx-toc__list">
        {entries.map((e) => (
          <li key={e.id} className={e.level === 2 ? "is-sub" : undefined}>
            <a href={`#${e.id}`} onClick={() => setOpen(false)}>{e.text}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function SpecialView({
  article,
  category,
  topics = [],
  tags,
  site,
  body,
  relatedSpecial = [],
  preview = false,
}: {
  article: Article;
  category: Category | null;
  topics?: Category[];
  tags: Tag[];
  site: SiteConfig;
  body: SpecialViewBody;
  relatedSpecial?: SpecialRelated[];
  preview?: boolean;
}) {
  const root = useRef<HTMLElement>(null);
  const chips = topics.length ? topics : category ? [category] : [];
  const path = `/special/${article.slug}`;
  const sources = body.sources;
  const minutes = readingMinutes(article);
  const words = article.wordCount ?? 0;
  const hasSidebar = body.toc.length >= 2;
  const corrections = article.corrections?.trim();
  const blocks = useMemo(() => body.blocks, [body.blocks]);
  return (
    <article className="article spx" ref={root}>
      <ReadingProgress target={root} />
      <div className="container">
        <header className="spx-hero">
          <p className="spx-kicker">
            <Link to="/special">Special report</Link>
            {chips[0] ? <><span aria-hidden="true"> · </span><Link to="/topics/$slug" params={{ slug: chips[0].slug }}>{chips[0].label}</Link></> : null}
          </p>
          <h1 className="article-title spx-title">{article.title}</h1>
          <p className="lede spx-lede">{article.excerpt}</p>
          <p className="meta spx-meta">
            <span className="byline">by {article.authorName?.trim() || site.publisher}</span>
            {article.publishedAt ? <span>{formatDate(article.publishedAt)}</span> : null}
            {isMeaningfullyUpdated(article.publishedAt, article.updatedAt) ? <span>Updated {formatDate(article.updatedAt)}</span> : null}
            <span>{minutes} {site.labels.minRead}</span>
            {words ? <span>{words.toLocaleString("en-US")} words</span> : null}
            {sources.length ? <span>{sources.length} sources</span> : null}
            {preview || article.status !== "published" ? <span className="spx-status">{article.status}</span> : null}
          </p>
          <SponsoredBy slug={article.slug} />
        </header>
        {article.coverMediaId ? (
          <figure className="spx-cover">
            <img src={mediaUrl(article.coverMediaId, "hero", article.coverImage?.v)} alt={article.coverAlt ?? article.title} width={article.coverImage?.w || 1280} height={article.coverImage?.h || 720} fetchPriority="high" decoding="async" />
            {body.coverCredit ? <figcaption>{renderInline(body.coverCredit, "cover")}</figcaption> : null}
          </figure>
        ) : null}
        <div className={hasSidebar ? "spx-layout" : "spx-layout spx-layout--full"}>
          {hasSidebar ? (
            <aside className="spx-side">
              <SpecialToc entries={body.toc} />
            </aside>
          ) : null}
          <div className="article-body spx-body">
            <SpecialBlocks blocks={blocks} slug={preview ? "" : article.slug} />
            {body.resources.length ? (
              <section className="spx-section" aria-labelledby="spx-resources">
                <h2 id="spx-resources">Documents &amp; resources</h2>
                <ul className="spx-resources">
                  {body.resources.map((r) => (
                    <li key={r.id}>
                      <a href={r.url} target="_blank" rel="noopener noreferrer nofollow" className="spx-resource">
                        <span className="spx-resource__provider">{PROVIDER[r.provider]}</span>
                        <strong>{r.title}</strong>
                        {r.description ? <span className="spx-resource__desc">{r.description}</span> : null}
                        <span className="spx-resource__meta">{[r.mime?.split("/").pop()?.toUpperCase(), fileSize(r.size)].filter(Boolean).join(" · ") || "Open"} ↗</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {sources.length ? (
              <section className="spx-section" aria-labelledby="spx-refs">
                <h2 id="spx-refs">References</h2>
                <ol className="spx-refs">
                  {sources.map((s) => (
                    <li key={s.id} id={`ref-${s.id}`}>
                      <a href={s.url} target="_blank" rel="noopener noreferrer nofollow">{s.title}</a>
                      {[s.authors, s.publisher, s.publishedAt ? formatDate(s.publishedAt) : ""].filter(Boolean).length ? (
                        <span className="spx-refs__meta"> — {[s.authors, s.publisher, s.publishedAt ? formatDate(s.publishedAt) : ""].filter(Boolean).join(", ")}</span>
                      ) : null}
                      {s.doi ? <span className="spx-refs__meta"> · DOI <a href={`https://doi.org/${s.doi}`} target="_blank" rel="noopener noreferrer nofollow">{s.doi}</a></span> : null}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
            {chips.length || tags.length ? (
              <ul className="topic-chips topic-chips--end" aria-label="Topics">
                {chips.map((t) => (
                  <li key={t.id}><Link to="/topics/$slug" params={{ slug: t.slug }} className="topic-chip">{t.label}</Link></li>
                ))}
                {tags.map((t) => (
                  <li key={t.id}><Link to="/search" search={{ q: t.label }} className="topic-chip topic-chip--tag">#{t.label}</Link></li>
                ))}
              </ul>
            ) : null}
            {corrections ? (
              <aside className="article-corrections" aria-labelledby="spx-corrections">
                <h2 id="spx-corrections">Correction</h2>
                <p>{corrections}</p>
              </aside>
            ) : null}
            <ShareLinks
              title={article.title}
              path={path}
              label="Share"
              copyLabel={site.labels.copyLink}
              copiedLabel={site.labels.linkCopied}
              buttons={site.share?.buttons}
              config={site.share}
              subject={{ slug: article.slug, excerpt: article.excerpt, seoTitle: article.seoTitle, seoDescription: article.seoDescription, author: article.authorName, category: chips[0]?.label ?? null }}
              siteName={site.name}
              publisher={site.publisher}
            />
            <AdSlot id="A4" />
          </div>
        </div>
        {relatedSpecial.length ? (
          <section className="section spx-related" aria-labelledby="spx-related">
            <h2 id="spx-related">More special reports</h2>
            <ul className="spx-cards">
              {relatedSpecial.map((r) => (
                <li key={r.id}>
                  <Link to="/special/$slug" params={{ slug: r.slug }} className="spx-card">
                    {r.coverMediaId ? <img src={thumbUrl(r.coverMediaId)} alt={r.coverAlt ?? ""} loading="lazy" width={480} height={270} /> : <span className="spx-card__ph" aria-hidden="true" />}
                    <span className="spx-card__body">
                      <strong>{r.title}</strong>
                      <span>{r.excerpt}</span>
                      <span className="spx-card__meta">{[r.publishedAt ? formatDate(r.publishedAt) : "", r.wordCount ? `${Math.max(1, Math.round(r.wordCount / 220))} min read` : ""].filter(Boolean).join(" · ")}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <AdSlot id="A5" />
      </div>
    </article>
  );
}

export function SpecialCards({ articles }: { articles: Array<Pick<Article, "id" | "slug" | "title" | "excerpt" | "publishedAt" | "coverMediaId" | "coverAlt" | "wordCount" | "coverImage">> }) {
  return (
    <ul className="spx-cards spx-cards--archive">
      {articles.map((a, i) => (
        <Fragment key={a.id}>
          <li className={i === 0 ? "is-lead" : undefined}>
            <Link to="/special/$slug" params={{ slug: a.slug }} className="spx-card">
              {a.coverMediaId ? (
                <img src={i === 0 ? mediaUrl(a.coverMediaId, "hero", a.coverImage?.v) : thumbUrl(a.coverMediaId, a.coverImage?.v)} alt={a.coverAlt ?? ""} loading={i === 0 ? "eager" : "lazy"} width={i === 0 ? 1280 : 480} height={i === 0 ? 720 : 270} />
              ) : <span className="spx-card__ph" aria-hidden="true" />}
              <span className="spx-card__body">
                <span className="spx-card__kicker">Special report</span>
                <strong>{a.title}</strong>
                <span>{a.excerpt}</span>
                <span className="spx-card__meta">{[a.publishedAt ? formatDate(a.publishedAt) : "", a.wordCount ? `${Math.max(1, Math.round(a.wordCount / 220))} min read` : ""].filter(Boolean).join(" · ")}</span>
              </span>
            </Link>
          </li>
        </Fragment>
      ))}
    </ul>
  );
}
