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
};

export function trackerHistoryWindow(win: Window, maxHoldMs = 1500): TrackerHistoryWindow {
  const real = win.history;
  const queue: HistoryCall[] = [];
  let holding = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const apply = ([push, args]: HistoryCall) => {
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
    holding = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(release, maxHoldMs);
  };
  const call = (push: boolean) => function (this: unknown, ...args: HistoryCall[1]) {
    if (holding) queue.push([push, args]);
    else apply([push, args]);
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
  win.addEventListener("popstate", () => { queue.length = 0; release(); }, { capture: true });
  // Leaving the page: make sure the address the visitor saw is in their history.
  win.addEventListener("pagehide", release);

  const proxy = new Proxy(win, {
    get(target, key) {
      if (key === "history") return history;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { window: proxy, hold, release, pending: () => queue.length };
}
