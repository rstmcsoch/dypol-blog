// t215/t216: smooth in-page scrolling + Back to top.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { armSmoothScroll, isPlainClick, prefersReducedMotion, SMOOTH_CLASS } from "./smooth-scroll.ts";

function fakeDoc(reduced = false) {
  const classes = new Set<string>();
  const listeners = new Map<string, () => void>();
  const doc = {
    documentElement: { classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) } },
    defaultView: { matchMedia: () => ({ matches: reduced }) },
    addEventListener: (n: string, fn: () => void) => listeners.set(n, fn),
    removeEventListener: (n: string) => listeners.delete(n),
  };
  return { doc: doc as unknown as Document, classes, listeners };
}
const click = (o: Partial<Record<"button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "defaultPrevented", unknown>> = {}) =>
  ({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false, ...o }) as Parameters<typeof isPlainClick>[0];

test("only plain primary clicks are smoothed; modifier / middle / prevented clicks stay native", () => {
  assert.equal(isPlainClick(click()), true);
  for (const o of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) assert.equal(isPlainClick(click(o)), false, JSON.stringify(o));
});

test("smooth class is scoped to one scroll: added, removed on scrollend; reduced motion never adds it", () => {
  const a = fakeDoc();
  armSmoothScroll(a.doc);
  assert.ok(a.classes.has(SMOOTH_CLASS));
  a.listeners.get("scrollend")!();
  assert.ok(!a.classes.has(SMOOTH_CLASS));
  const r = fakeDoc(true);
  armSmoothScroll(r.doc);
  assert.ok(!r.classes.has(SMOOTH_CLASS));
  assert.equal(prefersReducedMotion({ matchMedia: () => ({ matches: true }) } as never), true);
  assert.equal(prefersReducedMotion(undefined), false);
});

test("timeout fallback removes the class when scrollend never fires", async () => {
  const a = fakeDoc();
  const t = (globalThis as { setTimeout: typeof setTimeout }).setTimeout;
  let fire: (() => void) | undefined;
  (globalThis as { setTimeout: unknown }).setTimeout = ((fn: () => void) => ((fire = fn), 1)) as unknown;
  try {
    armSmoothScroll(a.doc);
    assert.ok(a.classes.has(SMOOTH_CLASS));
    fire!();
    assert.ok(!a.classes.has(SMOOTH_CLASS));
  } finally {
    (globalThis as { setTimeout: unknown }).setTimeout = t;
  }
});

test("CSS: smooth only under the scoped class, never globally; reduced motion forces instant; header offset kept", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(css, /html\.is-smooth-scrolling \{ scroll-behavior: smooth; \}/);
  assert.equal((css.match(/scroll-behavior: smooth/g) ?? []).length, 1, "no global smooth (router restoration stays instant)");
  assert.match(css, /prefers-reduced-motion: reduce\)[\s\S]*?scroll-behavior: auto !important/);
  assert.match(css, /scroll-padding-top: calc\(var\(--header-h\) \+ 0\.75rem\)/);
  const btt = css.slice(css.indexOf("/* ---- t215/t216"));
  assert.match(btt, /\.back-to-top \{[^}]*position: fixed;[^}]*env\(safe-area-inset-bottom/);
  assert.match(btt, /\.back-to-top \{[^}]*pointer-events: none/);
  assert.match(btt, /html\.nav-open \.back-to-top \{ display: none; \}/);
  assert.match(btt, /html:has\(\.consent-bar\) \.back-to-top/);
  assert.match(btt, /html\.has-ad-anchor \.back-to-top/);
  assert.match(btt, /orientation: landscape/);
  for (const m of btt.matchAll(/transition: ([^;]+);/g)) assert.doesNotMatch(m[1], /infinite|cubic-bezier\([^)]*-|bounce/);
  assert.doesNotMatch(btt, /animation:/, "no continuous animation");
});

test("components: both TOCs arm smooth scroll on plain clicks; Back to top is IO-based, labelled, in the public shell only", () => {
  for (const f of ["../components/site/reading-aids.tsx", "../components/site/special-view.tsx"]) {
    const s = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.match(s, /href=\{`#\$\{e\.id\}`\}/, `${f} keeps native hash href`);
    assert.match(s, /if \(isPlainClick\(ev\)\) armSmoothScroll\(\);/);
    assert.doesNotMatch(s, /preventDefault\(\)[\s\S]{0,80}scrollIntoView/);
  }
  const b = readFileSync(new URL("../components/site/back-to-top.tsx", import.meta.url), "utf8");
  assert.match(b, /new IntersectionObserver/);
  assert.match(b, /io\.disconnect\(\)/);
  assert.doesNotMatch(b, /addEventListener\("scroll"|requestAnimationFrame/);
  assert.match(b, /label = "Back to top"/);
  assert.match(b, /aria-label=\{label\}/);
  assert.match(b, /tabIndex=\{shown \? 0 : -1\}/);
  const root = readFileSync(new URL("../routes/__root.tsx", import.meta.url), "utf8");
  const desk = root.indexOf("if (desk) return <Outlet />;");
  assert.ok(desk > 0 && root.indexOf("<BackToTop />") > desk, "rendered only in the public shell (after the admin early-return)");
  assert.equal((root.match(/<BackToTop \/>/g) ?? []).length, 1);
});

test("fallback never cuts a long scroll: each scroll event pushes the cleanup back; idle then removes", () => {
  const a = fakeDoc();
  const t = (globalThis as { setTimeout: typeof setTimeout }).setTimeout;
  const c = (globalThis as { clearTimeout: typeof clearTimeout }).clearTimeout;
  const timers: { fn: () => void; ms: number; dead?: boolean }[] = [];
  (globalThis as { setTimeout: unknown }).setTimeout = ((fn: () => void, ms: number) => (timers.push({ fn, ms }), timers.length)) as unknown;
  (globalThis as { clearTimeout: unknown }).clearTimeout = ((id: number) => { if (timers[id - 1]) timers[id - 1].dead = true; }) as unknown;
  try {
    armSmoothScroll(a.doc);
    for (let i = 0; i < 20; i++) a.listeners.get("scroll")!();
    assert.ok(a.classes.has(SMOOTH_CLASS), "still smooth while scroll events keep arriving");
    assert.equal(timers.filter((x) => !x.dead).length, 1);
    const live = timers.find((x) => !x.dead)!;
    assert.equal(live.ms, 250);
    live.fn();
    assert.ok(!a.classes.has(SMOOTH_CLASS));
    assert.equal(a.listeners.size, 0, "listeners cleaned up");
  } finally {
    (globalThis as { setTimeout: unknown }).setTimeout = t;
    (globalThis as { clearTimeout: unknown }).clearTimeout = c;
  }
});
