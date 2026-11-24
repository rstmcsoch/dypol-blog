/**
 * t215: native smooth in-page scrolling, scoped to the moment of a user action.
 *
 * Root cause of the "jump": TOC links are plain `#id` anchors and the page uses the default
 * (instant) scroll-behavior. We do NOT set `scroll-behavior: smooth` globally — that would also
 * animate the router's scroll restoration on every navigation. Instead a class is put on <html>
 * just for the duration of one user-started scroll, so the browser's own fragment navigation (or
 * `window.scrollTo`) animates natively; it is removed on `scrollend` (or a timeout fallback).
 * Hash/history/:target/back-forward/direct-load semantics stay 100% native.
 * Reduced motion: the existing `prefers-reduced-motion` rule forces `scroll-behavior: auto`.
 */
export const SMOOTH_CLASS = "is-smooth-scrolling";
const FALLBACK_MS = 1500; // no scroll at all (e.g. already at target)
const IDLE_MS = 250; // scrolling stopped (browsers without scrollend)
const MAX_MS = 8000;

type MouseLike = { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean };

/** A plain primary click (no new tab/window/download modifiers). */
export function isPlainClick(e: MouseLike): boolean {
  return !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

export function prefersReducedMotion(win: Pick<Window, "matchMedia"> | undefined = typeof window === "undefined" ? undefined : window): boolean {
  try {
    return !!win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
let cleanup: (() => void) | undefined;

/**
 * Turn smooth scrolling on for the next user-started scroll only. Removed on `scrollend`; where
 * that event is missing, removed once scrolling has been idle for a moment (so a very long native
 * scroll is never cut short), with a hard cap.
 */
export function armSmoothScroll(doc: Document | undefined = typeof document === "undefined" ? undefined : document): void {
  if (!doc) return;
  if (prefersReducedMotion(doc.defaultView ?? undefined)) return;
  cleanup?.();
  const root = doc.documentElement;
  root.classList.add(SMOOTH_CLASS);
  const started = Date.now();
  const idle = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(done, Date.now() - started > MAX_MS ? 0 : IDLE_MS);
  };
  const done = () => {
    root.classList.remove(SMOOTH_CLASS);
    doc.removeEventListener("scrollend", done);
    doc.removeEventListener("scroll", idle);
    if (timer) clearTimeout(timer);
    timer = undefined;
    cleanup = undefined;
  };
  cleanup = done;
  doc.addEventListener("scrollend", done, { once: true });
  doc.addEventListener("scroll", idle, { passive: true });
  timer = setTimeout(done, FALLBACK_MS);
}
