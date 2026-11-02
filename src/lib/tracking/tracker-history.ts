/**
 * t191: tracker-friendly client navigation.
 *
 * Analytics snippets from Settings → Custom head code (PostHog `history_change`, GA4 enhanced
 * measurement, Clarity, Hotjar, Plausible, Umami, Meta Pixel, GTM history triggers …) record a
 * pageview the moment `history.pushState` runs and read `document.title` right then. The router
 * used to push the URL first and render the new page (and its <title>) afterwards, so every
 * client-side pageview carried the previous page's title.
 *
 * This hands the router a `window` whose `history` holds the browser URL update of a
 * navigation until the new page has rendered (its title set), then performs the real
 * pushState/replaceState, in order, exactly once. The router itself is told about the new
 * location immediately (unchanged behaviour); only the browser-visible URL waits, capped at
 * `maxHoldMs`. Popstate (back/forward) drops anything still held, since the browser has moved.
 *
 * Redirects: a replace that arrives while a push is still held (a loader redirect such as
 * /articles/x → /special/x) is folded into that push, so trackers see one pageview, for the
 * final URL only.
 *
 * Back/forward: the browser changes the URL and fires `popstate` before the app can render the
 * page, and trackers read `document.title` in their popstate listener (registered by the head
 * code, i.e. before ours, so they run first). Titles of pages already rendered in this tab are
 * remembered per URL; the Navigation API's `navigate` event, which fires before the URL changes
 * and before any popstate listener, sets the destination's remembered title. Browsers without
 * the Navigation API get it in our popstate listener (helps trackers that listen after us).
 * The router then renders the same title.
 */
type HistoryCall = [push: boolean, args: [data: unknown, unused: string, url?: string | URL | null]];

export type TrackerHistoryWindow = {
  window: Window;
  /** Start holding URL updates (a navigation began). */
  hold: () => void;
  /** Apply held URL updates now (the new page rendered). */
  release: () => void;
  /** Number of URL updates currently held. */
  pending: () => number;
  /** The current page has rendered: remember its title for back/forward. */
  rendered: () => void;
  /** This document is being left by a full page load: never publish held or later URL updates. */
  abandon: () => void;
};

const TITLES_KEY = "dypol:titles";
const MAX_TITLES = 100;

export function trackerHistoryWindow(win: Window, maxHoldMs = 1500): TrackerHistoryWindow {
  const real = win.history;
  const queue: HistoryCall[] = [];
  let holding = false;
  let abandoned = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // True while document.title belongs to the URL in the address bar.
  let inSync = true;
  const titles = new Map<string, string>();
  const storage = (() => { try { return win.sessionStorage; } catch { return undefined; } })();
  try { for (const [k, v] of JSON.parse(storage?.getItem(TITLES_KEY) || "[]") as [string, string][]) titles.set(k, v); } catch { /* ignore */ }
  const here = () => win.location.pathname + win.location.search;
  const remember = () => {
    if (!inSync) return;
    const title = win.document.title;
    if (!title) return;
    const key = here();
    titles.delete(key);
    titles.set(key, title);
    while (titles.size > MAX_TITLES) titles.delete(titles.keys().next().value!);
    try { storage?.setItem(TITLES_KEY, JSON.stringify([...titles])); } catch { /* quota / privacy mode */ }
  };

  const apply = ([push, args]: HistoryCall) => {
    if (abandoned) return;
    // Looked up at call time so trackers that patched window.history see the call.
    (push ? win.history.pushState : win.history.replaceState).apply(win.history, args);
  };
  const release = () => {
    holding = false;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    while (queue.length) apply(queue.shift()!);
  };
  const hold = () => {
    // The page being left is still on screen with its own title: remember it for "back".
    remember();
    holding = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(release, maxHoldMs);
  };
  const call = (push: boolean) => function (this: unknown, ...args: HistoryCall[1]) {
    if (!holding) return apply([push, args]);
    const last = queue[queue.length - 1];
    // A redirect replacing a navigation that never reached the browser: publish only the final URL.
    if (!push && last?.[0]) last[1] = args;
    else queue.push([push, args]);
  };

  const history = {
    get length() { return real.length; },
    // While held, the router's own state is what the browser will get.
    get state() { return queue.length ? queue[queue.length - 1]![1][0] : real.state; },
    get scrollRestoration() { return real.scrollRestoration; },
    set scrollRestoration(v: ScrollRestoration) { real.scrollRestoration = v; },
    back: () => real.back(),
    forward: () => real.forward(),
    go: (delta?: number) => real.go(delta),
    pushState: call(true),
    replaceState: call(false),
  } as unknown as History;

  // Back/forward while a URL update is held: the browser already moved, the held update is stale.
  win.addEventListener("popstate", () => {
    queue.length = 0;
    release();
    const title = titles.get(here());
    if (title) win.document.title = title;
    inSync = !!title;
  }, { capture: true });
  // Leaving the page: make sure the address the visitor saw is in their history.
  win.addEventListener("pagehide", release);
  type NavigateEvent = Event & { navigationType?: string; destination?: { url: string; sameDocument?: boolean } };
  const navigation = (win as unknown as { navigation?: EventTarget }).navigation;
  navigation?.addEventListener?.("navigate", (event) => {
    const { navigationType, destination } = event as NavigateEvent;
    if (navigationType !== "traverse" || !destination?.sameDocument) return;
    try {
      const url = new URL(destination.url);
      if (url.origin !== win.location.origin) return;
      const title = titles.get(url.pathname + url.search);
      if (title) win.document.title = title;
    } catch { /* ignore */ }
  });

  const proxy = new Proxy(win, {
    get(target, key) {
      if (key === "history") return history;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const rendered = () => { inSync = true; remember(); };
  const abandon = () => {
    abandoned = true;
    queue.length = 0;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return { window: proxy, hold, release, pending: () => queue.length, rendered, abandon };
}
