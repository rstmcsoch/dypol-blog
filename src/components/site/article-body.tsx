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
