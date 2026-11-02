/** t191: tracker-friendly client navigation (URL + title together for history-based analytics). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { trackerHistoryWindow } from "./tracker-history.ts";

function fakeWindow() {
  const calls: string[] = [];
  const listeners: Record<string, Array<() => void>> = {};
  let state: unknown = null;
  const history = {
    length: 1, scrollRestoration: "auto",
    get state() { return state; },
    pushState(s: unknown, _u: string, url: string) { state = s; go(url); calls.push(`push ${url} @${win.document.title}`); },
    replaceState(s: unknown, _u: string, url: string) { state = s; go(url); calls.push(`replace ${url} @${win.document.title}`); },
    back() {}, forward() {}, go() {},
  };
  const go = (url: string) => { const [pathname, q] = url.split("?"); win.location.pathname = pathname!; win.location.search = q ? `?${q}` : ""; };
  const win = {
    history, document: { title: "Old" }, location: { pathname: "/", search: "", origin: "https://blog.test" },
    addEventListener(t: string, f: () => void) { (listeners[t] ??= []).push(f); },
    removeEventListener() {},
  };
  return { win: win as unknown as Window & { document: { title: string } }, calls, go, fire: (t: string) => listeners[t]?.forEach((f) => f()) };
}

test("URL updates pass straight through when no navigation is in progress", () => {
  const { win, calls } = fakeWindow();
  const g = trackerHistoryWindow(win);
  g.window.history.replaceState({ k: 1 }, "", "/");
  assert.deepEqual(calls, ["replace / @Old"]);
  assert.equal(g.window.history.state && (g.window.history.state as { k: number }).k, 1);
  assert.equal(g.window.document, win.document);
});

test("a navigation's pushState waits for the render, then runs once with the new title; order kept", () => {
  const { win, calls } = fakeWindow();
  const g = trackerHistoryWindow(win, 10_000);
  g.hold();
  g.window.history.pushState({ i: 1 }, "", "/articles/a");
  g.window.history.pushState({ i: 2 }, "", "/articles/b");
  assert.deepEqual(calls, [], "nothing reaches the browser yet");
  assert.equal((g.window.history.state as { i: number }).i, 2, "router sees its pending state");
  assert.equal(g.pending(), 2);
  win.document.title = "Article B | DYPOL BLOG";
  g.release();
  g.release();
  assert.deepEqual(calls, ["push /articles/a @Article B | DYPOL BLOG", "push /articles/b @Article B | DYPOL BLOG"]);
});

test("a redirect (replace while the push is held) publishes one push of the final URL only", () => {
  const { win, calls } = fakeWindow();
  const g = trackerHistoryWindow(win, 10_000);
  g.hold();
  g.window.history.pushState({ i: 1 }, "", "/articles/x");
  g.hold();
  g.window.history.replaceState({ i: 1, r: 1 }, "", "/special/x");
  assert.equal(g.pending(), 1);
  assert.equal((g.window.history.state as { r: number }).r, 1);
  win.document.title = "X | DYPOL BLOG";
  g.release();
  assert.deepEqual(calls, ["push /special/x @X | DYPOL BLOG"]);
  // A replace with nothing held still goes straight through as a replace.
  g.window.history.replaceState({}, "", "/special/x?y=1");
  assert.deepEqual(calls.at(-1), "replace /special/x?y=1 @X | DYPOL BLOG");
});

test("back/forward: the remembered title is set before trackers' popstate listeners read it", () => {
  const { win, go, fire } = fakeWindow();
  win.document.title = "Home | DYPOL BLOG";
  const g = trackerHistoryWindow(win, 10_000);
  g.rendered();
  g.hold(); g.window.history.pushState({}, "", "/articles/a"); win.document.title = "A | DYPOL BLOG"; g.release(); g.rendered();
  g.hold(); g.window.history.pushState({}, "", "/articles/b"); win.document.title = "B | DYPOL BLOG"; g.release(); g.rendered();
  go("/articles/a"); fire("popstate");
  assert.equal(win.document.title, "A | DYPOL BLOG");
  go("/"); fire("popstate");
  assert.equal(win.document.title, "Home | DYPOL BLOG");
  // Unknown entry: title left alone, and nothing is remembered for it until it has rendered.
  go("/never-seen"); fire("popstate");
  assert.equal(win.document.title, "Home | DYPOL BLOG");
  g.hold();
  go("/articles/b"); fire("popstate");
  assert.equal(win.document.title, "B | DYPOL BLOG");
  go("/never-seen"); fire("popstate");
  assert.equal(win.document.title, "B | DYPOL BLOG");
});

test("trackers that patched window.history after startup still see the call", () => {
  const { win, calls } = fakeWindow();
  const g = trackerHistoryWindow(win, 10_000);
  const native = win.history.pushState;
  win.history.pushState = function (...a: Parameters<History["pushState"]>) { calls.push("tracker saw " + a[2]); return native.apply(this, a as never); };
  g.hold(); g.window.history.pushState({}, "", "/b"); win.document.title = "B"; g.release();
  assert.deepEqual(calls, ["tracker saw /b", "push /b @B"]);
});

test("hold is capped, and back/forward drops a stale held update", async () => {
  const { win, calls, fire } = fakeWindow();
  const g = trackerHistoryWindow(win, 20);
  g.hold(); g.window.history.pushState({}, "", "/c");
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(calls, ["push /c @Old"], "released by the cap");
  g.hold(); g.window.history.pushState({}, "", "/d");
  fire("popstate");
  assert.equal(g.pending(), 0);
  assert.deepEqual(calls, ["push /c @Old"], "stale /d not pushed after back");
  g.window.history.pushState({}, "", "/e");
  assert.deepEqual(calls.at(-1), "push /e @Old", "not holding after popstate");
});

test("back/forward with the Navigation API: the title is set in `navigate`, before the URL changes and before popstate", () => {
  const { win, go, fire } = fakeWindow();
  let onNavigate: ((e: Event) => void) | undefined;
  (win as unknown as { navigation: unknown }).navigation = { addEventListener: (_t: string, f: (e: Event) => void) => { onNavigate = f; } };
  win.document.title = "Home";
  const g = trackerHistoryWindow(win, 10_000);
  g.rendered();
  g.hold(); g.window.history.pushState({}, "", "/a"); win.document.title = "A"; g.release(); g.rendered();
  onNavigate!({ navigationType: "traverse", destination: { url: "https://blog.test/", sameDocument: true } } as unknown as Event);
  assert.equal(win.document.title, "Home", "set before trackers' popstate listeners run");
  go("/"); fire("popstate");
  assert.equal(win.document.title, "Home");
  onNavigate!({ navigationType: "push", destination: { url: "https://blog.test/a", sameDocument: true } } as unknown as Event);
  onNavigate!({ navigationType: "traverse", destination: { url: "https://other.test/a", sameDocument: false } } as unknown as Event);
  assert.equal(win.document.title, "Home", "only same-document traversals");
});

test("abandon: a document being left never publishes held or later URL updates", () => {
  const { win, calls } = fakeWindow();
  const g = trackerHistoryWindow(win, 10_000);
  g.hold(); g.window.history.pushState({}, "", "/login");
  g.abandon(); g.release();
  g.window.history.pushState({}, "", "/admin");
  g.window.history.replaceState({}, "", "/admin");
  assert.deepEqual(calls, []);
});
