import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { adminArticles } from "@/content/admin-api";
import { publicationStatuses } from "@/content/types";
import { formatDate } from "@/lib/format";

type Search = {
  q?: string;
  status?: (typeof publicationStatuses)[number];
  categoryId?: string;
  tagId?: string;
  sort?: "updated" | "published" | "title";
};

export const Route = createFileRoute("/admin/articles/")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    q: typeof search.q === "string" && search.q ? search.q : undefined,
    status: publicationStatuses.find((status) => status === search.status),
    categoryId: typeof search.categoryId === "string" && search.categoryId ? search.categoryId : undefined,
    tagId: typeof search.tagId === "string" && search.tagId ? search.tagId : undefined,
    sort: search.sort === "published" || search.sort === "title" || search.sort === "updated" ? search.sort : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => adminArticles({ data: deps }),
  component: ArticleIndex,
});

function ArticleIndex() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate();
  return (
    <>
      <p className="desk-kicker">Pieces</p>
      <h1 className="desk-title">Index</h1>
      <form
        className="filters"
        style={{ marginTop: "1rem" }}
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
            },
          });
        }}
      >
        <label className="field">
          <span>Search title or slug</span>
          <input name="q" defaultValue={search.q ?? ""} />
        </label>
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
          <span>Sort</span>
          <select name="sort" defaultValue={search.sort ?? "updated"}>
            <option value="updated">Updated</option>
            <option value="published">Published</option>
            <option value="title">Title</option>
          </select>
        </label>
        <button className="btn" type="submit">
          Filter
        </button>
      </form>
      <p style={{ margin: "1rem 0" }}>
        <Link to="/admin/articles/new" className="btn">
          New piece
        </Link>
      </p>
      {data.articles.length === 0 ? (
        <p className="desk-note">Nothing matches.</p>
      ) : (
        <div className="desk-table-wrap">
          <table className="desk-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Topic</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {data.articles.map((article) => (
                <tr key={article.id}>
                  <td>
                    <Link to="/admin/articles/$id" params={{ id: article.id }}>
                      {article.title}
                    </Link>
                    <div className="desk-note">{article.slug}</div>
                  </td>
                  <td>
                    <span className={article.status === "published" ? "desk-status desk-status--published" : "desk-status"}>
                      {article.status}
                      {article.featured ? " · featured" : ""}
                    </span>
                  </td>
                  <td>{article.categoryLabel}</td>
                  <td>{formatDate(article.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
