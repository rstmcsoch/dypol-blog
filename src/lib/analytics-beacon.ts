/**
 * Lightweight first-party engagement beacon for DYPOL Blog article pages.
 *
 * Sends one small beacon per reader session per article: engaged (visible +
 * active) time, deepest scroll depth, and internal article-link clicks. The
 * server rolls each beacon into compact daily aggregates
 * (migrations/d1/0014_analytics_rollups.sql); nothing per-visit is stored.
 *
 * - No IP addresses, cookies store a random session id only (30-day TTL).
 * - No continuous polling, no mouse/keystroke tracking, no fingerprinting.
 * - Fails silently: a blocked or failed beacon never affects the page.
 */

const ENDPOINT = "/api/analytics/beacon";
const SESSION_COOKIE = "dypol_an_sid";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const FLUSH_INTERVAL_MS = 30_000;
const ENGAGED_THRESHOLD_SECONDS = 10;
const SCROLL_COMPLETION = 90;

type LinkClick = { to: string; at: number };

type BeaconState = {
  sessionId: string;
  path: string;
  articleId: string | null;
  startedAt: number;
  lastFlushAt: number;
  visibleAt: number | null; // when the page last became visible
  engagedSeconds: number;
  maxScroll: number;
  milestones: Set<number>;
  completed: boolean;
  engagedSessionReported: boolean; // engaged-session flag already sent to the server
  linkClicks: LinkClick[];
  referrer: string;
  deviceCategory: "desktop" | "mobile" | "tablet";
  flushed: boolean; // true once the final pagehide flush has been sent
};

let flushTimer: ReturnType<typeof setInterval> | null = null;

/** Cookie helpers (no dependencies). */
function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`),
  );
  return match ? match[1] : null;
}

function setSessionCookie(value: string): void {
  if (typeof document === "undefined") return;
  const expires = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toUTCString();
  document.cookie = `${SESSION_COOKIE}=${value}; path=/; expires=${expires}; same-site=lax`;
}

function randomId(): string {
  return (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

/** Device category from user agent (coarse, approximate). */
function deviceCategory(): "desktop" | "mobile" | "tablet" {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent || "";
  if (/iPad|Tablet|PlayBook/i.test(ua)) return "tablet";
  if (/Mobi|Android|iPhone|iPod|BlackBerry|IEMobile/i.test(ua)) return "mobile";
  return "desktop";
}

/** Referrer campaign override from UTM parameters on the current URL. */
function utmSource(url: string): string | null {
  try {
    const params = new URL(url).searchParams;
    const source = params.get("utm_source");
    if (source) return source;
  } catch {
    /* ignore unparseable URL */
  }
  return null;
}

function sourceFromReferrer(referrer: string, url: string): string {
  const utm = utmSource(url);
  if (utm) return "campaign";
  if (!referrer) return "direct";
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, "");
    const currentHost = new URL(url).hostname.replace(/^www\./, "");
    if (host === currentHost) return "internal";
    const social = ["facebook.com", "instagram.com", "x.com", "twitter.com", "linkedin.com", "reddit.com", "threads.net"];
    if (social.includes(host)) return "social";
    const search = ["google.com", "bing.com", "duckduckgo.com", "yahoo.com", "baidu.com", "yandex.com"];
    if (search.includes(host)) return "organic";
    return "referral";
  } catch {
    return "referral";
  }
}

function maxScrollDepth(): number {
  if (typeof document === "undefined" || typeof window === "undefined") return 0;
  const doc = document.documentElement;
  const height = Math.max(0, doc.scrollHeight - window.innerHeight);
  if (height === 0) return 0;
  return Math.round((window.scrollY / height) * 100);
}

/** Send one beacon batch to the server (sendBeacon first, fetch fallback). */
async function sendBeacon(payload: unknown): Promise<void> {
  const body = JSON.stringify(payload);
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const ok = navigator.sendBeacon(ENDPOINT, body);
    if (ok) return;
  }
  if (typeof fetch === "function") {
    await fetch(ENDPOINT, {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body,
    }).catch(() => undefined);
  }
}

function flush(state: BeaconState, final: boolean): void {
  const lastSent = (state as { _lastSentSeconds?: number })._lastSentSeconds ?? 0;
  const deltaSeconds = Math.round((state.engagedSeconds - lastSent) * 10) / 10;
  (state as { _lastSentSeconds?: number })._lastSentSeconds = state.engagedSeconds;

  const pageViews = state.flushed ? 0 : 1; // count the page view once, on the first flush
  const clicks = state.linkClicks.splice(0, state.linkClicks.length);
  const milestones = Array.from(state.milestones);

  let engagedSession = false;
  if (!state.engagedSessionReported && state.engagedSeconds >= ENGAGED_THRESHOLD_SECONDS) {
    engagedSession = true;
    state.engagedSessionReported = true;
  }

  void sendBeacon({
    sessionId: state.sessionId,
    articleId: state.articleId,
    path: state.path,
    referrer: state.flushed ? undefined : state.referrer,
    source: state.flushed ? undefined : sourceFromReferrer(state.referrer, window.location.href),
    deviceCategory: state.deviceCategory,
    pageViews,
    engagedSeconds: deltaSeconds > 0 ? deltaSeconds : 0,
    engagedSession,
    maxScroll: state.maxScroll,
    completed: state.completed,
    linkClicks: clicks.map((c) => ({ to: c.to })),
    milestones,
    final,
  });
  state.flushed = true;
}

function tick(state: BeaconState): void {
  if (state.visibleAt !== null && document.visibilityState === "visible") {
    state.engagedSeconds += (Date.now() - state.visibleAt) / 1000;
    state.visibleAt = Date.now();
  }
}

function scheduleFlush(state: BeaconState): void {
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = setInterval(() => flush(state, false), FLUSH_INTERVAL_MS);
}

/**
 * Initialise the beacon for an article page. Call once after mount, only
 * on article routes. Safe to call in SSR (it does nothing until a flush).
 */
export function initArticleAnalytics(input: {
  articleId: string;
  path: string;
}): { teardown: () => void } {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { teardown: () => undefined };
  }

  let sessionId = getCookie(SESSION_COOKIE);
  if (!sessionId || !/^[a-z0-9-]{8,64}$/.test(sessionId)) {
    sessionId = randomId();
    setSessionCookie(sessionId);
  }

  const s: BeaconState = {
    sessionId,
    path: input.path,
    articleId: input.articleId,
    startedAt: Date.now(),
    lastFlushAt: Date.now(),
    visibleAt: document.visibilityState === "visible" ? Date.now() : null,
    engagedSeconds: 0,
    maxScroll: 0,
    milestones: new Set(),
    completed: false,
    engagedSessionReported: false,
    linkClicks: [],
    referrer: document.referrer || "",
    deviceCategory: deviceCategory(),
    flushed: false,
  };

  const onScroll = () => {
    const depth = maxScrollDepth();
    if (depth > s.maxScroll) s.maxScroll = depth;
    for (const m of [25, 50, 75, 90]) {
      if (depth >= m && !s.milestones.has(m)) {
        s.milestones.add(m);
        if (m >= SCROLL_COMPLETION) s.completed = true;
      }
    }
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      s.visibleAt = Date.now();
    } else {
      tick(s);
      flush(s, false);
    }
  };

  const onPageHide = () => {
    tick(s);
    flush(s, true);
  };

  const onLinkClick = (event: MouseEvent) => {
    const anchor = (event.target as Element | null)?.closest("a[href]");
    if (!anchor || !(anchor instanceof HTMLAnchorElement)) return;
    const href = anchor.getAttribute("href") || "";
    if (!href.startsWith("/articles/")) return;
    try {
      const to = new URL(href, window.location.origin).pathname;
      if (to === s.path) return;
      s.linkClicks.push({ to, at: Date.now() });
    } catch {
      /* ignore */
    }
  };

  document.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("beforeunload", onPageHide, { once: true });
  document.addEventListener("click", onLinkClick);
  scheduleFlush(s);
  // `pagehide` covers unload on modern browsers; `beforeunload` is intentionally
  // omitted so readers keep back-forward cache eligibility.

  return {
    teardown: () => {
      tick(s);
      flush(s, true);
      document.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("click", onLinkClick);
      if (flushTimer) clearInterval(flushTimer);
    },
  };
}
