import type { ArticleBlock } from "@/content/types";
import { renderInline } from "@/components/markdown";
import { stripCreditsAndSources } from "@/lib/automation/body";
import { inlinePlain } from "@/lib/inline-markdown";

/**
 * Article prose (t106). Every text field goes through the safe inline
 * renderer (bold, italic, links, entities …) — including At a glance items,
 * table cells, spec rows and callouts. No HTML passthrough.
 */
export function ArticleBody({ blocks }: { blocks: ArticleBlock[] }) {
  return (
    <div className="article-body">
      <ProseBlocks blocks={stripCreditsAndSources(blocks)} />
    </div>
  );
}

const NUMERIC_CELL = /^[\s(]*[-+−~≈<>±]?\s*[$€£¥₹]?\s*\d[\d,.\s]*(%|x|×|[kKMBT]|bn|mn|GB|TB|MB|KB|mAh|Wh|W|V|Hz|kHz|MHz|GHz|ms|s|fps|nm|mm|cm|in|"|g|kg|lbs?|°C|°F|pts?|tokens?)?[\s)*]*$/;

function slug(text: string): string {
  return inlinePlain(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function cellAlign(block: Extract<ArticleBlock, { type: "table" }>, col: number): "left" | "center" | "right" | undefined {
  const explicit = block.align?.[col];
  if (explicit) return explicit;
  const cells = block.rows.map((r) => (r[col] ?? "").replace(/[*_]/g, "").trim()).filter(Boolean);
  return col > 0 && cells.length > 0 && cells.every((c) => NUMERIC_CELL.test(c)) ? "right" : undefined;
}

export function ProseBlocks({ blocks }: { blocks: ArticleBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        switch (block.type) {
          case "paragraph":
            return <p key={key}>{renderInline(block.text, key)}</p>;
          case "heading": {
            const Tag = block.level === 4 ? "h4" : block.level === 3 ? "h3" : "h2";
            return (
              <Tag key={key} id={slug(block.text) || undefined}>
                {renderInline(block.text, key)}
              </Tag>
            );
          }
          case "list": {
            const ListTag = block.ordered ? "ol" : "ul";
            return (
              <ListTag key={key}>
                {block.items.map((item, i) => {
                  const kids = block.children?.[i] ?? [];
                  return (
                    <li key={`${key}-${i}`}>
                      {renderInline(item, `${key}-${i}`)}
                      {kids.length ? (
                        <ul>
                          {kids.map((kid, k) => (
                            <li key={`${key}-${i}-${k}`}>{renderInline(kid, `${key}-${i}-${k}`)}</li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ListTag>
            );
          }
          case "takeaways":
            return (
              <section key={key} className="takeaways" aria-label="At a glance">
                <h2 className="takeaways__title">At a glance</h2>
                <ul>
                  {block.items.map((item, i) => (
                    <li key={`${key}-${i}`}>{renderInline(item, `${key}-${i}`)}</li>
                  ))}
                </ul>
              </section>
            );
          case "table": {
            const cols = Math.max(block.headers.length, ...block.rows.map((r) => r.length));
            const aligns = Array.from({ length: cols }, (_, c) => cellAlign(block, c));
            const label = block.headers.filter(Boolean).map(inlinePlain).join(", ");
            return (
              <div key={key} className="article-table-wrap" role="region" aria-label={label ? `Table: ${label}` : "Table"} tabIndex={0}>
                <table className="data-table">
                  {block.headers.some((h) => h.trim()) ? (
                    <thead>
                      <tr>
                        {block.headers.map((h, c) => (
                          <th key={c} scope="col" style={aligns[c] ? { textAlign: aligns[c] } : undefined}>
                            {renderInline(h, `${key}-h${c}`)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                  ) : null}
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, c) =>
                          c === 0 ? (
                            <th key={c} scope="row" style={aligns[c] ? { textAlign: aligns[c] } : undefined}>
                              {renderInline(cell, `${key}-${r}-${c}`)}
                            </th>
                          ) : (
                            <td key={c} className={aligns[c] === "right" ? "num" : undefined} style={aligns[c] ? { textAlign: aligns[c] } : undefined}>
                              {renderInline(cell, `${key}-${r}-${c}`)}
                            </td>
                          ),
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          case "specs":
            return (
              <section key={key} className="spec-card" aria-label={block.title ? inlinePlain(block.title) : "Key specs"}>
                <h3 className="spec-card__title">{block.title ? renderInline(block.title, `${key}-t`) : "Key specs"}</h3>
                <dl className="spec-card__list">
                  {block.rows.map((row, r) => (
                    <div key={r} className="spec-card__row">
                      <dt>{renderInline(row[0] ?? "", `${key}-${r}-l`)}</dt>
                      <dd>{renderInline(row[1] ?? "", `${key}-${r}-v`)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
          case "callout":
            return (
              <aside key={key} className={`callout callout--${block.tone}`} role="note">
                <p className="callout__title">{block.title || (block.tone === "takeaway" ? "Key takeaway" : block.tone.charAt(0).toUpperCase() + block.tone.slice(1))}</p>
                <p>{renderInline(block.text, key)}</p>
              </aside>
            );
          case "divider":
            return <hr key={key} />;
          case "quote":
            return (
              <blockquote key={key} className={block.attribution ? "pullquote" : undefined}>
                <p>{renderInline(block.text, key)}</p>
                {block.attribution ? <footer>— {renderInline(block.attribution, `${key}-a`)}</footer> : null}
              </blockquote>
            );
          case "code":
            return (
              <pre key={key}>
                <code>{block.code}</code>
              </pre>
            );
          default:
            return null;
        }
      })}
    </>
  );
}
