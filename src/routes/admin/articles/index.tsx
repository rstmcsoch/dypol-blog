import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { DeleteArticleButton } from "@/components/admin/delete-article";
import { DeleteOldArticles } from "@/components/admin/delete-old-articles";
import { adminArticles, adminSetAiEditAllowed } from "@/content/admin-api";
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
  const router = useRouter();
  return (
    <>
      <p className="desk-kicker">Content</p>
      <h1 className="desk-title">Articles</h1>
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
          New article
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
                <th>Cover</th>
                <th>Updated</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
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
                    {article.aiEditAllowed ? <span className="desk-status" title="An AI connected over MCP may edit this published article (never delete or unpublish it)"> · AI edit allowed</span> : null}
                  </td>
                  <td>{article.categoryLabel}{(article.topicIds?.length ?? 0) > 1 ? <span className="desk-note"> +{article.topicIds.length - 1} more</span> : null}</td>
                  <td>{article.hasCover ? "✓ Image" : "No image"}</td>
                  <td>{formatDate(article.updatedAt)}</td>
                  <td>
                    <div className="adm-row-actions">
                      <Link to="/admin/articles/$id" params={{ id: article.id }} className="btn btn--ghost">
                        Edit
                      </Link>
                      {article.status === "published" ? (
                        <a href={`/articles/${article.slug}`} target="_blank" rel="noreferrer" className="btn btn--ghost">
                          View
                        </a>
                      ) : null}
                      {article.status === "published" ? (
                        <button
                          type="button"
                          className="btn btn--ghost"
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
      )}
      <DeleteOldArticles onDeleted={() => router.invalidate()} />
    </>
  );
}
