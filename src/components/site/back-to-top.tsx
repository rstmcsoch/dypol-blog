import { useEffect, useRef, useState } from "react";
import { armSmoothScroll } from "@/lib/smooth-scroll";

/**
 * t215/t216: small circular "Back to top" control for every public page (rendered by the public
 * shell only — the admin desk has its own layout). Visibility comes from one IntersectionObserver on
 * a top-of-page sentinel one viewport tall (no scroll listener, no per-frame work). Scrolling is the
 * browser's own smooth scroll; reduced motion scrolls instantly. Focus moves to the skip target so
 * keyboard users continue from the top.
 */
export function BackToTop({ label = "Back to top" }: { label?: string }) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setShown(!entry.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const goTop = () => {
    armSmoothScroll();
    window.scrollTo({ top: 0 });
    const target = document.getElementById("content");
    if (target) {
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    }
  };

  return (
    <>
      <div ref={sentinel} className="back-to-top__sentinel" aria-hidden="true" />
      <button
        type="button"
        className={shown ? "back-to-top is-shown" : "back-to-top"}
        aria-label={label}
        title={label}
        tabIndex={shown ? 0 : -1}
        aria-hidden={shown ? undefined : true}
        onClick={goTop}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
          <path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </>
  );
}
