import { useEffect, useRef, useState } from "react";
import type { ArticleBlock } from "@/content/types";
import { inlinePlain } from "@/lib/inline-markdown";

/** Same id rule as the rendered H2s in ArticleBody. */
export function headingId(text: string): string {
  return inlinePlain(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function words(blocks: ArticleBlock[]): number {
  let n = 0;
  for (const b of blocks) {
    const text =
      b.type === "paragraph" || b.type === "heading" ? b.text : b.type === "list" ? b.items.join(" ") : "";
    n += inlinePlain(text).split(/\s+/).filter(Boolean).length;
  }
  return n;
}

/** t115: TOC rule — 4+ H2s, or 700+ words with at least 2 H2s. */
export function tocEntries(blocks: ArticleBlock[]): { id: string; text: string }[] {
  const h2 = blocks
    .filter((b): b is Extract<ArticleBlock, { type: "heading" }> => b.type === "heading" && (b.level ?? 2) === 2)
    .map((b) => ({ id: headingId(b.text), text: inlinePlain(b.text) }))
    .filter((h) => h.id);
  if (h2.length >= 4 || (h2.length >= 2 && words(blocks) >= 700)) return h2;
  return [];
}

/** Auto table of contents: always open on wide screens, collapsible on phones. */
export function TableOfContents({ entries }: { entries: { id: string; text: string }[] }) {
  const [open, setOpen] = useState(false);
  if (entries.length === 0) return null;
  return (
    <nav className={open ? "toc is-open" : "toc"} aria-label="In this article">
      <button type="button" className="toc__toggle" aria-expanded={open} aria-controls="toc-list" onClick={() => setOpen((v) => !v)}>
        <span>In this article</span>
        <span className="toc__chev" aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      <p className="toc__title">In this article</p>
      <ol id="toc-list" className="toc__list">
        {entries.map((e) => (
          <li key={e.id}>
            <a href={`#${e.id}`} onClick={() => setOpen(false)}>{e.text}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Reading progress across the article, in the accent colour (grained). */
export function ReadingProgress({ target }: { target: React.RefObject<HTMLElement | null> }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const el = target.current;
      if (!el || !bar.current) return;
      const rect = el.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const p = total <= 0 ? 1 : Math.min(1, Math.max(0, -rect.top / total));
      bar.current.style.transform = `scaleX(${p})`;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [target]);
  return (
    <div className="reading-progress" aria-hidden="true">
      <div ref={bar} className="reading-progress__bar grain" />
    </div>
  );
}
