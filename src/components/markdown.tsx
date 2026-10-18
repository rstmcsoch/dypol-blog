import type { ReactNode } from "react";

/** Tiny, safe markdown renderer for the built-in help (no HTML passthrough). */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    const key = `${keyBase}-${i++}`;
    if (token.startsWith("`")) out.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("**")) out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      const href = link?.[2] ?? "";
      const safe = /^(https?:\/\/|\/|#)/.test(href);
      out.push(safe ? <a key={key} href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">{link?.[1]}</a> : link?.[1]);
    }
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (line.startsWith("```")) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").startsWith("```")) code.push(lines[i++] ?? "");
      i += 1;
      blocks.push(<pre key={k++}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const text = h[2];
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const content = inline(text, `h${k}`);
      blocks.push(level <= 1 ? <h1 key={k++} id={id} className="md-h1">{content}</h1> : level === 2 ? <h2 key={k++} id={id}>{content}</h2> : <h3 key={k++} id={id}>{content}</h3>);
      i += 1;
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i] ?? "")) {
        let item = (lines[i] ?? "").replace(/^\s*([-*]|\d+\.)\s+/, "");
        i += 1;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i] ?? "") && !/^\s*([-*]|\d+\.)\s+/.test(lines[i] ?? "")) item += ` ${(lines[i++] ?? "").trim()}`;
        items.push(item);
      }
      const lis = items.map((item, n) => <li key={n}>{inline(item, `l${k}-${n}`)}</li>);
      blocks.push(ordered ? <ol key={k++}>{lis}</ol> : <ul key={k++}>{lis}</ul>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && (lines[i] ?? "").trim() && !/^(#{1,4}\s|```|\s*([-*]|\d+\.)\s+)/.test(lines[i] ?? "")) para.push((lines[i++] ?? "").trim());
    blocks.push(<p key={k++}>{inline(para.join(" "), `p${k}`)}</p>);
  }
  return <>{blocks}</>;
}
