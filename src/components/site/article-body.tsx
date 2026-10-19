import type { ArticleBlock } from "@/content/types";

export function ArticleBody({ blocks }: { blocks: ArticleBlock[] }) {
  return (
    <div className="article-body">
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        if (block.type === "paragraph") return <p key={key}>{block.text}</p>;
        if (block.type === "heading" && block.level === 2) return <h2 key={key}>{block.text}</h2>;
        if (block.type === "heading") return <h3 key={key}>{block.text}</h3>;
        if (block.type === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag key={key}>
              {block.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ListTag>
          );
        }
        if (block.type === "takeaways") {
          return (
            <section key={key} className="takeaways" aria-label="At a glance">
              <h2>At a glance</h2>
              <ul>
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`}>{item}</li>
                ))}
              </ul>
            </section>
          );
        }
        if (block.type === "table") {
          return (
            <div key={key} className="article-table-wrap">
              <table>
                {block.headers.length ? (
                  <thead>
                    <tr>{block.headers.map((h, hIndex) => <th key={hIndex} scope="col">{h}</th>)}</tr>
                  </thead>
                ) : null}
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (block.type === "quote") {
          return (
            <blockquote key={key}>
              <p>{block.text}</p>
              {block.attribution ? <footer>{block.attribution}</footer> : null}
            </blockquote>
          );
        }
        return (
          <pre key={key}>
            <code>{block.code}</code>
          </pre>
        );
      })}
    </div>
  );
}
