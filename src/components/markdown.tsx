import type { ReactNode } from "react";
import { bodyToBlocks } from "@/lib/automation/body";
import { isExternalHref, parseInline, type InlineNode } from "@/lib/inline-markdown";
import { CANONICAL_ORIGIN } from "@/lib/seo";
import { ProseBlocks } from "@/components/site/article-body";

/** Hosts known at render time (server and client alike, so hydration matches). */
const RENDER_OWN_HOSTS = [new URL(CANONICAL_ORIGIN).host];

function renderNodes(nodes: InlineNode[], keyBase: string): ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyBase}-${i}`;
    switch (node.t) {
      case "text":
        return node.v;
      case "code":
        return <code key={key}>{node.v}</code>;
      case "br":
        return <br key={key} />;
      case "strong":
        return <strong key={key}>{renderNodes(node.c, key)}</strong>;
      case "em":
        return <em key={key}>{renderNodes(node.c, key)}</em>;
      case "del":
        return <del key={key}>{renderNodes(node.c, key)}</del>;
      case "link": {
        // Absolute links to another host open in a new tab even without JS; with
        // JS the ExternalLinkGuard asks first (and keeps own-host links in-tab).
        const external = isExternalHref(node.href, RENDER_OWN_HOSTS);
        return (
          <a
            key={key}
            href={node.href}
            className="prose-link"
            title={node.title}
            {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}
          >
            {renderNodes(node.c, key)}
          </a>
        );
      }
    }
  });
}

/**
 * Safe inline markdown (t106): **bold**, *italic*, ***both***, ~~strike~~,
 * `code`, [links](url), bare URLs, HTML entities. No HTML passthrough.
 */
export function renderInline(text: string, keyBase: string): ReactNode[] {
  return renderNodes(parseInline(text ?? ""), keyBase);
}

/** Markdown for pages, sidebar text blocks and the built-in help: same parser and renderer as articles. */
export function Markdown({ source }: { source: string }) {
  return <ProseBlocks blocks={bodyToBlocks(source ?? "")} />;
}
