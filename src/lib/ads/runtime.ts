/**
 * t148: browser-side ad runtime. Everything here is defensive: an ad network
 * script that throws, hangs or never fills can never break the page.
 */
import { deviceForWidth, type AdRules, type Device } from "./model.ts";
import { adOrigins } from "./head-html.ts";

const CONSENT_KEY = "dypol-ad-consent";
const CAP_KEY = "dypol-ad-cap";
const ANCHOR_KEY = "dypol-ad-anchor-closed";
const NOADS_KEY = "dypol-noads";

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function currentDevice(): Device {
  return deviceForWidth(typeof window === "undefined" ? 1280 : window.innerWidth);
}

// ---------- flags ----------
export function noAdsRequested(): boolean {
  if (typeof window === "undefined") return false;
  const q = new URLSearchParams(window.location.search).get("noads");
  if (q === "1") safe(() => sessionStorage.setItem(NOADS_KEY, "1"), undefined);
  if (q === "0") safe(() => sessionStorage.removeItem(NOADS_KEY), undefined);
  return safe(() => sessionStorage.getItem(NOADS_KEY) === "1", false);
}

// ---------- consent ----------
export type ConsentChoice = "yes" | "no" | null;
const consentListeners = new Set<() => void>();

export function consentChoice(): ConsentChoice {
  const v = safe(() => localStorage.getItem(CONSENT_KEY), null);
  return v === "yes" || v === "no" ? v : null;
}

export function setConsentChoice(v: "yes" | "no"): void {
  safe(() => localStorage.setItem(CONSENT_KEY, v), undefined);
  for (const fn of consentListeners) safe(fn, undefined);
}

export function onConsentChange(fn: () => void): () => void {
  consentListeners.add(fn);
  return () => consentListeners.delete(fn);
}

// ---------- frequency cap (per creative per IST day) ----------
function capDay(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}
function readCaps(): Record<string, number> {
  const raw = safe(() => JSON.parse(localStorage.getItem(CAP_KEY) ?? "null"), null) as { day?: string; n?: Record<string, number> } | null;
  return raw && raw.day === capDay() && raw.n ? raw.n : {};
}
export function capReached(creativeId: string, cap: number): boolean {
  return cap > 0 && (readCaps()[creativeId] ?? 0) >= cap;
}
export function noteCapView(creativeId: string): void {
  const n = readCaps();
  n[creativeId] = (n[creativeId] ?? 0) + 1;
  safe(() => localStorage.setItem(CAP_KEY, JSON.stringify({ day: capDay(), n })), undefined);
}

// ---------- mobile anchor ----------
export function anchorClosed(): boolean {
  return safe(() => sessionStorage.getItem(ANCHOR_KEY) === "1", false);
}
export function closeAnchor(): void {
  safe(() => sessionStorage.setItem(ANCHOR_KEY, "1"), undefined);
}

// ---------- code injection (sequential, scripts re-created so they run) ----------
let queue: Promise<void> = Promise.resolve();

function cloneScript(old: HTMLScriptElement): HTMLScriptElement {
  const s = document.createElement("script");
  for (const a of Array.from(old.attributes)) s.setAttribute(a.name, a.value);
  // Always async (never blocks parsing/LCP); order is kept by awaiting each external script below.
  if (old.src) s.async = true;
  s.text = old.text;
  return s;
}

// ---------- hosts that failed to load on this visit (ad blocker / DNS block) ----------
const blockedHosts = new Set<string>();
const blockedListeners = new Set<() => void>();
function noteBlocked(src: string): void {
  try {
    const origin = `https://${new URL(src, location.href).host}`;
    if (blockedHosts.has(origin)) return;
    blockedHosts.add(origin);
    for (const fn of blockedListeners) safe(fn, undefined);
  } catch {
    /* ignore */
  }
}
/** True when every external host this code loads from has already failed on this visit. */
export function hostsBlocked(html: string): boolean {
  if (!blockedHosts.size) return false;
  const hosts = adOrigins([html]);
  return hosts.length > 0 && hosts.every((h) => blockedHosts.has(h));
}
export function onHostBlocked(fn: () => void): () => void {
  blockedListeners.add(fn);
  return () => blockedListeners.delete(fn);
}

/** Result of running ad code: how many external scripts it had and how many failed (blocked / offline). */
export type RunResult = { external: number; failed: number };

async function runScripts(root: ParentNode, result: RunResult = { external: 0, failed: 0 }): Promise<RunResult> {
  for (const old of Array.from(root.querySelectorAll("script"))) {
    const s = cloneScript(old as HTMLScriptElement);
    if (s.src) {
      result.external += 1;
      s.addEventListener("error", () => { result.failed += 1; noteBlocked(s.src); }, { once: true });
    }
    const waitLoad = !!s.src && !old.hasAttribute("async") && !old.hasAttribute("defer");
    const loaded = waitLoad
      ? new Promise<void>((resolve) => {
          s.addEventListener("load", () => resolve(), { once: true });
          s.addEventListener("error", () => resolve(), { once: true });
          setTimeout(resolve, 8000);
        })
      : null;
    try {
      old.replaceWith(s);
    } catch (error) {
      console.warn("[ads] script failed to start", error);
    }
    if (loaded) await loaded;
  }
  return result;
}

/** Inserts slot code and runs its scripts (queued, so Adsterra-style globals never race). */
export function injectHtml(target: HTMLElement, html: string): Promise<RunResult> {
  const result: RunResult = { external: 0, failed: 0 };
  const job = async () => {
    try {
      const tpl = document.createElement("template");
      tpl.innerHTML = html;
      target.replaceChildren(tpl.content);
      await runScripts(target, result);
    } catch (error) {
      console.warn("[ads] code could not be inserted", error);
    }
  };
  queue = queue.then(job, job);
  return queue.then(() => result);
}

/** True when the network code could not load at all (ad blocker, DNS block, offline). */
export function codeBlocked(r: RunResult): boolean {
  return r.external > 0 && r.failed >= r.external;
}

/** Network code in its own sandboxed document (Adsterra-style globals, document.write). */
export function isolatedFrame(html: string, w: number, h: number): HTMLIFrameElement {
  const f = document.createElement("iframe");
  f.setAttribute("sandbox", "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation");
  f.setAttribute("scrolling", "no");
  f.setAttribute("title", "Advertisement");
  f.setAttribute("loading", "lazy");
  f.width = String(w);
  f.height = String(h);
  f.style.border = "0";
  f.style.display = "block";
  f.style.maxWidth = "100%";
  f.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}</style>${FILL_REPORTER}</head><body>${html}</body></html>`;
  return f;
}

/* Inside an isolated frame: tell the page whether anything rendered (5 s), or right away when every script was blocked. */
const FILL_REPORTER = `<script>(function(){var d=0,n=0,f=0;function has(){var l=document.querySelectorAll("iframe,img,video,canvas,object,embed");for(var i=0;i<l.length;i++){var r=l[i].getBoundingClientRect();if(r.width>1&&r.height>1)return 1}return 0}function s(v){if(d)return;d=1;try{parent.postMessage({dypolAdFill:v},"*")}catch(e){}}document.addEventListener("error",function(e){var t=e.target;if(t&&t.tagName==="SCRIPT"){f++;setTimeout(function(){n=document.querySelectorAll("script[src]").length;if(f>=n&&!has())s(0)},50)}},true);setTimeout(function(){s(has())},5000)})()<\/script>`;

/** Collapse an isolated frame that reports no fill. */
export function watchIsolated(frame: HTMLIFrameElement, onEmpty: () => void): () => void {
  const onMsg = (e: MessageEvent) => {
    if (e.source === frame.contentWindow && e.data && typeof e.data === "object" && "dypolAdFill" in e.data && !e.data.dypolAdFill) onEmpty();
  };
  window.addEventListener("message", onMsg);
  return () => window.removeEventListener("message", onMsg);
}

/** Global head/body code: appended once, scripts executed in order. Static head tags the server already rendered are not repeated. */
export function injectGlobal(html: string, where: "head" | "body", id: string): void {
  if (document.querySelector(`[data-ad-global="${CSS.escape(id)}"], [data-ad-global-item="${CSS.escape(id)}"]`)) return;
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const ssrStatic = !!document.querySelector(`[data-ad-head="${CSS.escape(id)}"]`);
  const nodes = Array.from(tpl.content.childNodes).filter((n) => !(ssrStatic && n instanceof Element && !(n instanceof HTMLScriptElement)));
  const host = where === "head" ? document.head : document.body;
  const marker = document.createElement("template");
  marker.setAttribute("data-ad-global", id);
  host.appendChild(marker);
  const job = async () => {
    for (const n of nodes) {
      try {
        if (n instanceof HTMLScriptElement) {
          const s = cloneScript(n);
          s.setAttribute("data-ad-global-item", id);
          const wait = !!s.src && !n.hasAttribute("async") && !n.hasAttribute("defer");
          const loaded = wait ? new Promise<void>((r) => { s.addEventListener("load", () => r(), { once: true }); s.addEventListener("error", () => r(), { once: true }); setTimeout(r, 8000); }) : null;
          host.appendChild(s);
          if (loaded) await loaded;
        } else if (n instanceof Element) {
          n.setAttribute("data-ad-global-item", id);
          host.appendChild(n);
          await runScripts(n);
        }
      } catch (error) {
        console.warn("[ads] global code failed", error);
      }
    }
  };
  queue = queue.then(job, job);
}

// ---------- fill detection ----------
/** Text a reader would see (inline <script>/<style> code such as atOptions does not count as a fill). */
function visibleText(el: HTMLElement): string {
  const c = el.cloneNode(true) as HTMLElement;
  c.querySelectorAll("script, style, noscript, template").forEach((n) => n.remove());
  return (c.textContent ?? "").trim();
}
type GoogleTag = { cmd?: { push(fn: () => void): void }; pubads?: () => { addEventListener(name: string, fn: (e: { isEmpty: boolean; slot: { getSlotElementId(): string } }) => void): void } };

/**
 * Calls onEmpty when the network returns no ad: AdSense data-ad-status,
 * GAM slotRenderEnded.isEmpty, otherwise "no iframe/img/video after 5 s".
 */
export function watchFill(frame: HTMLElement, opts: { timeoutMs?: number; onEmpty: () => void; onFilled?: () => void }): () => void {
  let settled = false;
  const settle = (empty: boolean) => {
    if (settled) return;
    settled = true;
    (empty ? opts.onEmpty : opts.onFilled ?? (() => undefined))();
  };
  const check = () => {
    const ins = frame.querySelector("ins.adsbygoogle, ins[data-ad-status]");
    const status = ins?.getAttribute("data-ad-status");
    if (status === "unfilled") return settle(true);
    if (status === "filled") return settle(false);
  };
  const mo = new MutationObserver(check);
  mo.observe(frame, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-ad-status"] });
  const gt = (window as unknown as { googletag?: GoogleTag }).googletag;
  if (gt?.cmd) {
    safe(() => gt.cmd!.push(() => gt.pubads?.().addEventListener("slotRenderEnded", (e) => {
      const el = document.getElementById(e.slot.getSlotElementId());
      if (el && frame.contains(el)) settle(e.isEmpty);
    })), undefined);
  }
  const timer = window.setTimeout(() => {
    if (settled) return;
    const ins = frame.querySelector("ins.adsbygoogle");
    if (ins && !ins.getAttribute("data-ad-status")) {
      // AdSense still working: give it more time, then decide by content.
      window.setTimeout(() => settle(!frame.querySelector("iframe")), 5000);
      return;
    }
    const filled = Array.from(frame.querySelectorAll("iframe, img, video, canvas, object, embed")).some((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    }) || visibleText(frame).length > 0;
    settle(!filled);
  }, opts.timeoutMs ?? 5000);
  check();
  return () => {
    mo.disconnect();
    window.clearTimeout(timer);
  };
}

// ---------- impressions (50 % visible for 1 s) ----------
const pending: { slot: string; creative: string }[] = [];
let flushTimer: number | null = null;

function flush(): void {
  if (!pending.length) return;
  const body = JSON.stringify({ events: pending.splice(0, 30) });
  try {
    if (!navigator.sendBeacon?.("/api/ad-events", new Blob([body], { type: "application/json" }))) {
      void fetch("/api/ad-events", { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => undefined);
    }
  } catch {
    /* stats are best-effort */
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flush);
}

export function trackImpression(el: HTMLElement, slot: string, creative: string, onSeen?: () => void): () => void {
  if (typeof IntersectionObserver === "undefined") return () => undefined;
  let timer: number | null = null;
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          if (timer === null) {
            timer = window.setTimeout(() => {
              io.disconnect();
              pending.push({ slot, creative });
              onSeen?.();
              if (flushTimer === null) flushTimer = window.setTimeout(() => { flushTimer = null; flush(); }, 4000);
            }, 1000);
          }
        } else if (timer !== null) {
          window.clearTimeout(timer);
          timer = null;
        }
      }
    },
    { threshold: [0, 0.5, 1] },
  );
  io.observe(el);
  return () => {
    io.disconnect();
    if (timer !== null) window.clearTimeout(timer);
  };
}

/** Lazy start: runs once the element is within rootMargin of the viewport (250 px default). */
export function whenNear(el: HTMLElement, fn: () => void, rootMargin = "250px"): () => void {
  if (typeof IntersectionObserver === "undefined") {
    fn();
    return () => undefined;
  }
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      io.disconnect();
      fn();
    }
  }, { rootMargin: `${rootMargin} 0px` });
  io.observe(el);
  return () => io.disconnect();
}

// ---------- layout rules (soft, owner-editable) ----------
const firstScreen = { decided: false, used: 0 };
function armFirstScreen(): void {
  if (typeof window !== "undefined") window.addEventListener("scroll", () => { firstScreen.decided = true; }, { once: true, passive: true });
}
armFirstScreen();

function activeSlots(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".ad-slot:not(.is-collapsed):not([data-preview])")).filter((el) => el.offsetParent !== null || getComputedStyle(el).position === "fixed");
}

function contentBetween(a: Element, b: Element): boolean {
  const range = document.createRange();
  range.setStartAfter(a);
  range.setEndBefore(b);
  const frag = range.cloneContents();
  frag.querySelectorAll(".ad-slot, .ad-cell, [hidden], script, style, template").forEach((n) => n.remove());
  return (frag.textContent ?? "").replace(/\s+/g, "").length > 0 || !!frag.querySelector("img, picture, video, svg");
}

/** True when the owner's rules say this slot should stay empty here. */
const OUT_OF_FLOW = ".ad-anchor, .ad-rail, .article-aside, .rail-col, .topic-row__side";

export function suppressedByRules(el: HTMLElement, rules: AdRules): boolean {
  // Fixed/side placements (anchor, rails, sidebar stacks) are outside the reading flow.
  if (el.closest(OUT_OF_FLOW)) return false;
  if (rules.noBackToBack) {
    const others = activeSlots().filter((o) => o !== el && !o.closest(OUT_OF_FLOW));
    const prev = others.filter((o) => o.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).pop();
    if (prev && !prev.contains(el) && !contentBetween(prev, el)) return true;
  }
  if (rules.firstMobileScreenOne && currentDevice() === "mobile" && !firstScreen.decided && window.scrollY < 40) {
    const top = el.getBoundingClientRect().top;
    if (top < window.innerHeight) {
      const headline = document.querySelector<HTMLElement>("main h1:not(.sr-only), main .display, main h2");
      const headTop = headline ? headline.getBoundingClientRect().top : 0;
      if (top < headTop || firstScreen.used >= 1) return true;
      firstScreen.used += 1;
    }
  }
  return false;
}

export function resetPageRules(): void {
  firstScreen.decided = window.scrollY > 40;
  firstScreen.used = 0;
  armFirstScreen();
}
