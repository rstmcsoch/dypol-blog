import { useEffect, useRef, useState } from "react";
import { EMBED_SCRIPTS, embedBlockquote, type SocialEmbed as Embed } from "@/lib/social-embed";

const loaded = new Map<string, Promise<void>>();

function loadScript(src: string, fresh = false): Promise<void> {
  if (!fresh && loaded.has(src)) return loaded.get(src)!;
  const p = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`embed script failed: ${src}`));
    document.body.appendChild(s);
  });
  loaded.set(src, p);
  return p;
}

type W = Window & {
  twttr?: { widgets?: { load: (el?: Element) => void } };
  instgrm?: { Embeds?: { process: () => void } };
};

function upgrade(e: Embed) {
  const src = EMBED_SCRIPTS[e.provider];
  if (!src) return;
  const w = window as W;
  if (e.provider === "x" && w.twttr?.widgets) return w.twttr.widgets.load();
  if (e.provider === "instagram" && w.instgrm?.Embeds) return w.instgrm.Embeds.process();
  // TikTok and Threads scan the page on load; re-run the script for blockquotes added later.
  void loadScript(src, (e.provider === "tiktok" || e.provider === "threads") && loaded.has(src)).catch(() => undefined);
}

function currentTheme(): "light" | "dark" {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark" || attr === "light") return attr;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Responsive, lazy social embed with a plain link fallback. */
export function SocialEmbed({ embed }: { embed: Embed }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [html, setHtml] = useState(() => embedBlockquote(embed, "light"));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) { setNear(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((x) => x.isIntersecting)) { setNear(true); io.disconnect(); }
    }, { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!near || embed.kind !== "script") return;
    setHtml(embedBlockquote(embed, currentTheme()));
  }, [near, embed]);

  useEffect(() => {
    if (!near || embed.kind !== "script") return;
    const id = requestAnimationFrame(() => upgrade(embed));
    return () => cancelAnimationFrame(id);
  }, [near, embed, html]);

  const cls = `social-embed social-embed--${embed.provider} social-embed--${(embed.aspect ?? "post").replace("/", "x")}`;
  if (embed.kind === "iframe") {
    return (
      <figure ref={ref} className={cls}>
        <div className="social-embed__frame">
          {near ? (
            <iframe
              src={embed.src}
              title={`${embed.label} embed`}
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
              allowFullScreen
              sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms"
            />
          ) : null}
        </div>
        <figcaption>
          <a href={embed.url} target="_blank" rel="noopener noreferrer nofollow">Watch on {embed.label} ↗</a>
        </figcaption>
      </figure>
    );
  }
  return <div ref={ref} className={cls} dangerouslySetInnerHTML={{ __html: html }} />;
}
