import { useEffect } from "react";
import { postJson, readAcquisition } from "./meter";

/**
 * Counts one article view per tab session (same rule as before) and, when the
 * reader leaves, sends a single beacon with visible time, max scroll and
 * internal article clicks. No interval pings.
 */
export function ArticleEngage({ slug }: { slug: string }) {
  useEffect(() => {
    const key = `dypol-viewed:${slug}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* private mode still counts */
    }
    const fields = readAcquisition();
    postJson(`/api/views/${slug}`, fields);

    let accumulated = 0;
    let since: number | null = null;
    let maxScroll = 0;
    let clicks = 0;
    let sent = false;
    const end = document.getElementById("article-end");

    const depth = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      if (max <= 8) return 100;
      return Math.max(0, Math.min(100, (window.scrollY / max) * 100));
    };
    const sample = () => {
      maxScroll = Math.max(maxScroll, depth());
    };
    const start = () => {
      if (document.visibilityState === "visible" && since == null) since = performance.now();
    };
    const pause = () => {
      if (since != null) {
        accumulated += performance.now() - since;
        since = null;
      }
    };
    const flush = () => {
      if (sent) return;
      sent = true;
      pause();
      sample();
      postJson("/api/engage", {
        slug,
        ...fields,
        engagedMs: Math.max(0, Math.min(1_200_000, Math.round(accumulated))),
        scrollPct: Math.round(maxScroll),
        internalClicks: Math.min(30, clicks),
      });
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const href = target.closest("a")?.getAttribute("href") ?? "";
      if (href.startsWith("/articles/") && !href.startsWith(`/articles/${slug}`)) clicks += 1;
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
      else start();
    };
    let observer: IntersectionObserver | null = null;
    if (end && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) maxScroll = 100;
      });
      observer.observe(end);
    }
    start();
    sample();
    window.addEventListener("scroll", sample, { passive: true });
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVis);
    document.addEventListener("click", onClick, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("scroll", sample);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVis);
      document.removeEventListener("click", onClick, true);
      flush();
    };
  }, [slug]);
  return null;
}
