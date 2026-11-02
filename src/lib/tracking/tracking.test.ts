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
    pushState(s: unknown, _u: string, url: string) { state = s; calls.push(`push ${url} @${win.document.title}`); },
    replaceState(s: unknown, _u: string, url: string) { state = s; calls.push(`replace ${url} @${win.document.title}`); },
    back() {}, forward() {}, go() {},
  };
  const win = {
    history, document: { title: "Old" }, location: { pathname: "/" },
    addEventListener(t: string, f: () => void) { (listeners[t] ??= []).push(f); },
    removeEventListener() {},
  };
  return { win: win as unknown as Window & { document: { title: string } }, calls, fire: (t: string) => listeners[t]?.forEach((f) => f()) };
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
  g.window.history.replaceState({ i: 1, s: 1 }, "", "/articles/a?x=1");
  assert.deepEqual(calls, [], "nothing reaches the browser yet");
  assert.equal((g.window.history.state as { s: number }).s, 1, "router sees its pending state");
  assert.equal(g.pending(), 2);
  win.document.title = "Article A | DYPOL BLOG";
  g.release();
  g.release();
  assert.deepEqual(calls, ["push /articles/a @Article A | DYPOL BLOG", "replace /articles/a?x=1 @Article A | DYPOL BLOG"]);
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
