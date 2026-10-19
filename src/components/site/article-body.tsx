import type { ArticleBlock } from "@/content/types";
import { renderInline } from "@/components/markdown";

/**
 * Article prose (t91 Phase 1). Text is rendered through the same safe inline
 * renderer as the rest of the site: **bold**, `code`, [label](url) and bare
 * https URLs become real links. This makes the stored Sources list (plain
 * URLs by design in the automation contract) clickable and lets authors add
 * contextual internal/external links without any storage or MCP change.
 * No HTML passthrough: markup in article text is shown, never executed.
 */
export function ArticleBody({ blocks }: { blocks: ArticleBlock[] }) {
  return (
    <div className="article-body">
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        if (block.type === "paragraph") return <p key={key}>{renderInline(block.text, key)}</p>;
        if (block.type === "heading" && block.level === 2) return <h2 key={key}>{renderInline(block.text, key)}</h2>;
        if (block.type === "heading") return <h3 key={key}>{renderInline(block.text, key)}</h3>;
        if (block.type === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
              ))}
            </ListTag>
          );
        }
        if (block.type === "quote") {
          return (
            <blockquote key={key}>
              <p>{renderInline(block.text, key)}</p>
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
