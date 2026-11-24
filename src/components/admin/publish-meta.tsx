import { formatPublishedVia, type ArticleProvenance } from "@/lib/publish-source";

export function PublishMetaFields({
  authorName,
  onAuthorChange,
  authors,
  provenance,
  listId = "known-authors",
}: {
  authorName: string;
  onAuthorChange: (value: string) => void;
  authors: string[];
  provenance: ArticleProvenance | null;
  listId?: string;
}) {
  const shown = formatPublishedVia(provenance ?? { created: null, published: null, publishedAt: null, status: "draft" });
  return (
    <div className="publish-meta" data-testid="article-publish-meta">
      <label className="field">
        <span>Author</span>
        <input
          value={authorName}
          maxLength={60}
          placeholder="DYPOL LABS"
          list={authors.length ? listId : undefined}
          data-testid="article-author"
          autoComplete="off"
          onChange={(event) => onAuthorChange(event.target.value)}
        />
        {authors.length ? (
          <datalist id={listId}>
            {authors.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        ) : null}
        <span className="field-help">
          The name shown in the public byline. Pick a known writer or type a new name. AI articles get the next name
          from their automation profile&apos;s author rotation when first published; a name typed here is kept instead.
        </span>
      </label>
      <div className="field">
        <span>Published via</span>
        <p className="publish-via" data-testid="article-published-via">
          <span>{shown.primary}</span>
          {shown.secondary ? <span className="publish-via__sub">{shown.secondary}</span> : null}
        </p>
        <span className="field-help">Which MCP connection or the admin desk first published this article, with the date and time in IST. Only visible in the desk.</span>
      </div>
    </div>
  );
}
