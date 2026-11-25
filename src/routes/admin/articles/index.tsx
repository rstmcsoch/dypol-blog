import "@/styles-content-admin.css";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { adminPending } from "@/components/admin/pending";
import { DeleteArticleButton } from "@/components/admin/delete-article";
import { DeleteOldArticles } from "@/components/admin/delete-old-articles";
import { adminArticles, adminDuplicateArticle, adminSetAiEditAllowed } from "@/content/admin-api";
import { publicationStatuses } from "@/content/types";
import { formatDate } from "@/lib/format";

const PAGE_SIZE = 15;

type Search = {
  q?: string;
  status?: (typeof publicationStatuses)[number];
  categoryId?: string;
  tagId?: string;
  sort?: "updated" | "published" | "title";
  type?: "special" | "regular";
  page?: number;
};

function pageButtons(current: number, total: number): (number | "gap")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const keep = new Set<number>([1, total, current - 1, current, current + 1]);
  if (current <= 3) {
    keep.add(2);
    keep.add(3);
    keep.add(4);
  } else if (current >= total - 2) {
    keep.add(total - 3);
    keep.add(total - 2);
    keep.add(total - 1);
  }
  const sorted = [...keep].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1]! === 2) out.push(n - 1);
    else if (i > 0 && n - sorted[i - 1]! > 2) out.push("gap");
    out.push(n);
  });
  return out;
}

export const Route = createFileRoute("/admin/articles/")({
  ...adminPending,
  validateSearch: (search: Record<string, unknown>): Search => {
    const rawPage = Number(search.page);
    const page = Number.isInteger(rawPage) && rawPage >= 2 ? rawPage : undefined;
    return {
      q: typeof search.q === "string" && search.q ? search.q : undefined,
      status: publicationStatuses.find((status) => status === search.status),
      categoryId: typeof search.categoryId === "string" && search.categoryId ? search.categoryId : undefined,
      tagId: typeof search.tagId === "string" && search.tagId ? search.tagId : undefined,
      sort: search.sort === "published" || search.sort === "title" || search.sort === "updated" ? search.sort : undefined,
      type: search.type === "special" || search.type === "regular" ? search.type : undefined,
      page,
    };
  },
  loaderDeps: ({ search }) => ({
    q: search.q,
    status: search.status,
    categoryId: search.categoryId,
    tagId: search.tagId,
    sort: search.sort,
    type: search.type,
  }),
  loader: ({ deps }) => {
    const { type, ...rest } = deps;
    return adminArticles({ data: type ? { ...rest, articleType: type } : rest });
  },
  component: ArticleIndex,
});

function ArticleIndex() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const hasFilters = Boolean(search.q || search.status || search.categoryId || search.tagId || search.type || (search.sort && search.sort !== "updated"));

  const total = data.articles.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, search.page ?? 1), totalPages);
  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const pageArticles = data.articles.slice(startIdx, startIdx + PAGE_SIZE);
  const showingFrom = total === 0 ? 0 : startIdx + 1;
  const showingTo = Math.min(startIdx + PAGE_SIZE, total);

  const goPage = (next: number) => {
    const clamped = Math.min(Math.max(1, next), totalPages);
    void navigate({
      to: "/admin/articles",
      search: {
        ...search,
        page: clamped > 1 ? clamped : undefined,
      },
    });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <>
      <p className="desk-kicker">Content</p>
      <div className="ca-head">
        <h1 className="desk-title">Articles</h1>
        <span className="ca-pill">{total} {total === 1 ? "article" : "articles"}</span>
      </div>

      <div className="sp-chooser" role="group" aria-label="Create an article">
        <Link to="/admin/articles/new" className="sp-choice" data-testid="new-normal-article">
          <span className="sp-choice__icon" aria-hidden="true">✎</span>
          <span className="sp-choice__body">
            <strong>New Normal Article</strong>
            <span>The everyday editor: news, explainers and quick reads.</span>
          </span>
          <span className="sp-choice__go" aria-hidden="true">→</span>
        </Link>
        <Link to="/admin/special/new" className="sp-choice sp-choice--special" data-testid="new-special-article">
          <span className="sp-choice__icon" aria-hidden="true">★</span>
          <span className="sp-choice__body">
            <strong>New Special Article</strong>
            <span>Long-form research: sections and contents, images with captions, tables, charts, references and documents.</span>
          </span>
          <span className="sp-choice__go" aria-hidden="true">→</span>
        </Link>
      </div>

      <form
        className="art-filters"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const read = (key: string) => {
            const value = String(form.get(key) ?? "");
            return value || undefined;
          };
          void navigate({
            to: "/admin/articles",
            search: {
              q: read("q"),
              status: publicationStatuses.find((status) => status === read("status")),
              categoryId: read("categoryId"),
              tagId: read("tagId"),
              sort: read("sort") === "title" || read("sort") === "published" ? (read("sort") as "title" | "published") : undefined,
              type: read("type") === "special" || read("type") === "regular" ? (read("type") as "special" | "regular") : undefined,
              page: undefined,
            },
          });
        }}
      >
        <div className="art-filters__top">
          <label className="field art-filters__search">
            <span>Search title or slug</span>
            <input name="q" defaultValue={search.q ?? ""} placeholder="Search by title or slug…" />
          </label>
          <button className="btn btn--primary" type="submit">
            Filter
          </button>
          {hasFilters ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => void navigate({ to: "/admin/articles", search: {} })}
            >
              Clear
            </button>
          ) : null}
        </div>

        <div className="art-filters__grid">
          <label className="field">
            <span>Status</span>
            <select name="status" defaultValue={search.status ?? ""}>
              <option value="">Any</option>
              {publicationStatuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Topic</span>
            <select name="categoryId" defaultValue={search.categoryId ?? ""}>
              <option value="">Any</option>
              {data.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Tag</span>
            <select name="tagId" defaultValue={search.tagId ?? ""}>
              <option value="">Any</option>
              {data.tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Type</span>
            <select name="type" defaultValue={search.type ?? ""}>
              <option value="">All</option>
              <option value="regular">Normal</option>
              <option value="special">Special</option>
            </select>
          </label>
          <label className="field">
            <span>Sort</span>
            <select name="sort" defaultValue={search.sort ?? "updated"}>
              <option value="updated">Updated</option>
              <option value="published">Published</option>
              <option value="title">Title</option>
            </select>
          </label>
        </div>
      </form>

      {total === 0 ? (
        <p className="desk-note">Nothing matches.</p>
      ) : (
        <div className="art-table-card">
          <div className="desk-table-wrap">
            <table className="desk-table">
              <thead>
                <tr>
                  <th>Article</th>
                  <th>Status</th>
                  <th>Stats</th>
                  <th>Updated</th>
                  <th style={{ textAlign: "right" }}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageArticles.map((article) => (
                  <tr key={article.id}>
                    <td>
                      {article.articleType === "special" ? (
                        <Link to="/admin/special/$id" params={{ id: article.id }} className="art-title-link">
                          {article.title}
                        </Link>
                      ) : (
                        <Link to="/admin/articles/$id" params={{ id: article.id }} className="art-title-link">
                          {article.title}
                        </Link>
                      )}
                      <div className="art-meta-line">
                        {article.articleType === "special" ? <span className="sp-badge">Special</span> : null}
                        <span className="ca-pill">
                          {article.categoryLabel}
                          {(article.topicIds?.length ?? 0) > 1 ? ` +${article.topicIds.length - 1}` : ""}
                        </span>
                        <span className="art-slug">{article.slug}</span>
                      </div>
                    </td>
                    <td>
                      <div className="art-badges">
                        <span className={article.status === "published" ? "ca-pill ca-pill--pub" : "ca-pill"}>
                          {article.status}
                        </span>
                        {article.featured ? <span className="ca-pill ca-pill--accent">Featured</span> : null}
                        {article.scheduledAt ? (
                          <span className="ca-pill" title={`Scheduled to publish ${formatDate(article.scheduledAt)}`}>
                            Scheduled {formatDate(article.scheduledAt)}
                          </span>
                        ) : null}
                        {article.topicReview && article.status === "draft" ? (
                          <span className="ca-pill ca-pill--warn" title="Automation filed this under a single topic but its content signals others. Open it and check Topics before publishing.">
                            ⚠ Topic review
                          </span>
                        ) : null}
                        {article.aiEditAllowed ? (
                          <span className="ca-pill" title="An AI connected over MCP may edit this published article (never delete or unpublish it)">
                            AI edit
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <div className="art-stats">
                        <span>{article.views.toLocaleString()} views · {article.words.toLocaleString()} words</span>
                        <span className="art-stats__muted">{article.hasCover ? "✓ Cover image" : "No cover"}</span>
                      </div>
                    </td>
                    <td style={{ whiteSpace: "nowrap", fontSize: "0.82rem" }}>{formatDate(article.updatedAt)}</td>
                    <td>
                      <div className="art-actions">
                        {article.articleType === "special" ? (
                          <Link to="/admin/special/$id" params={{ id: article.id }} className="btn btn--ghost btn--sm">
                            Edit
                          </Link>
                        ) : (
                          <Link to="/admin/articles/$id" params={{ id: article.id }} className="btn btn--ghost btn--sm">
                            Edit
                          </Link>
                        )}
                        {article.status === "published" ? (
                          <a href={article.articleType === "special" ? `/special/${article.slug}` : `/articles/${article.slug}`} target="_blank" rel="noreferrer" className="btn btn--ghost btn--sm">
                            View
                          </a>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          title="Copy this article into a new draft"
                          onClick={() => {
                            void adminDuplicateArticle({ data: { id: article.id } })
                              .then((copy) =>
                                article.articleType === "special"
                                  ? router.navigate({ to: "/admin/special/$id", params: { id: copy.id } })
                                  : router.navigate({ to: "/admin/articles/$id", params: { id: copy.id } }),
                              )
                              .catch(() => router.invalidate());
                          }}
                        >
                          Duplicate
                        </button>
                        {article.status === "published" ? (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            title="Let an AI connected over MCP edit this one published article (it still cannot delete it or change its status)"
                            onClick={() => {
                              void adminSetAiEditAllowed({ data: { id: article.id, allowed: !article.aiEditAllowed } }).then(() => router.invalidate());
                            }}
                          >
                            {article.aiEditAllowed ? "Revoke AI edit" : "Allow AI edit"}
                          </button>
                        ) : null}
                        <DeleteArticleButton
                          id={article.id}
                          title={article.title}
                          status={article.status}
                          hasCover={article.hasCover}
                          onDeleted={() => router.invalidate()}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="art-pager" data-testid="articles-pagination">
            <span className="art-pager__info">
              Showing {showingFrom}–{showingTo} of {total}
            </span>
            {totalPages > 1 ? (
              <nav className="art-pager__nav" aria-label="Articles pagination">
                <button
                  type="button"
                  className="art-pager__btn"
                  aria-label="Previous page"
                  disabled={currentPage <= 1}
                  onClick={() => goPage(currentPage - 1)}
                >
                  ←
                </button>
                {pageButtons(currentPage, totalPages).map((item, idx) =>
                  item === "gap" ? (
                    <span key={`gap-${idx}`} className="art-pager__gap" aria-hidden="true">
                      …
                    </span>
                  ) : (
                    <button
                      key={item}
                      type="button"
                      className={`art-pager__btn${item === currentPage ? " is-active" : ""}`}
                      aria-current={item === currentPage ? "page" : undefined}
                      onClick={() => goPage(item)}
                    >
                      {item}
                    </button>
                  ),
                )}
                <button
                  type="button"
                  className="art-pager__btn"
                  aria-label="Next page"
                  disabled={currentPage >= totalPages}
                  onClick={() => goPage(currentPage + 1)}
                >
                  →
                </button>
              </nav>
            ) : null}
          </div>
        </div>
      )}

      <div style={{ marginTop: "1rem" }}>
        <DeleteOldArticles onDeleted={() => router.invalidate()} />
      </div>
    </>
  );
}
