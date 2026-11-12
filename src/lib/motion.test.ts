import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const css = read("src/styles.css");
const motion = read("src/lib/motion.ts");
const route = read("src/components/site/route-motion.tsx");
const rootTsx = read("src/routes/__root.tsx");
const shell = read("src/components/admin/shell.tsx");
const leave = read("src/components/site/external-link-guard.tsx");
const header = read("src/components/site/header.tsx");
const router = read("src/router.tsx");
const article = read("src/routes/articles/$slug.tsx");

test("t220 tokens: 180ms enter, 140ms exit; reduced-motion zeros them; opacity/transform only", () => {
  assert.match(css, /--motion:\s*180ms/);
  assert.match(css, /--motion-exit:\s*140ms/);
  assert.match(motion, /export const MOTION_MS = 180/);
  assert.match(motion, /export const MOTION_EXIT_MS = 140/);
  const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /--motion:\s*0ms/);
  assert.match(reduced, /\.route-motion/);
  assert.match(reduced, /\.leave-dialog/);
  assert.match(reduced, /\.site-nav/);
  const block = css.slice(
    css.indexOf("@keyframes route-in"),
    css.indexOf("@keyframes route-in") + 220,
  );
  assert.match(block, /opacity: 0/);
  assert.match(block, /translateY\(6px\)/);
  assert.doesNotMatch(block, /width:|height:|top:|margin:|padding:/);
});

test("t220 route motion: public outlet only, after hydration, pathname not hash; no View Transitions", () => {
  assert.match(rootTsx, /<main id="content">\s*<RouteMotion>\s*<Outlet \/>\s*<\/RouteMotion>/);
  assert.match(route, /armed\.current = true/);
  assert.match(route, /\[pathname\]/);
  assert.doesNotMatch(route, /location\.hash|defaultViewTransition|startViewTransition/);
  assert.doesNotMatch(router, /defaultViewTransition|startViewTransition/);
  assert.doesNotMatch(rootTsx, /desk[\s\S]{0,80}RouteMotion/);
});

test("t220 article skeleton delay is unchanged (no artificial wait)", () => {
  assert.match(article, /pendingComponent: ArticlePagePending/);
  assert.match(article, /pendingMs: 200/);
});

test("t220 dialogs use starting-style transitions (close stays native)", () => {
  for (const sel of [".leave-dialog", ".adm-dialog", ".adm-previewdlg"]) {
    assert.ok(css.includes(`@starting-style`) && css.includes(sel), sel);
  }
  assert.match(leave, /onCancel/);
  assert.match(leave, /showModal\(\)/);
  assert.match(leave, /dialog.close()/);
});

test("t220 menus: presence keeps exit then unmounts; aria-expanded still follows real open state", () => {
  assert.match(shell, /const notifMenu = usePresence\(menu === "notif"\)/);
  assert.match(shell, /const profileMenu = usePresence\(menu === "profile"\)/);
  assert.match(shell, /const customizerPanel = usePresence\(customizer\)/);
  assert.match(shell, /aria-expanded=\{menu === "profile"\}/);
  assert.match(shell, /aria-expanded=\{menu === "notif"\}/);
  assert.match(shell, /aria-expanded=\{customizer\}/);
  assert.match(shell, /data-motion=\{profileMenu\.leaving \? "out" : "in"\}/);
  assert.match(motion, /clearTimeout/);
  assert.match(motion, /prefersReducedMotion\(\) \? 0 : exitMs/);
});

test("t220 mobile menu: opacity/visibility transition only, no restyle of background or buttons", () => {
  const nav = css.slice(
    css.indexOf("@media (max-width: 959px)"),
    css.indexOf("@media (max-width: 959px)") + 1800,
  );
  assert.match(nav, /transition: opacity var\(--motion\)[^{]+visibility var\(--motion\)/);
  assert.match(header, /className=\{open \? "site-nav is-open" : "site-nav"\}/);
});
