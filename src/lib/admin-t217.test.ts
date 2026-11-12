import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const settings = read("src/routes/admin/settings.tsx");
const homepage = read("src/routes/admin/homepage.tsx");
const dialog = read("src/components/admin/home-preview-dialog.tsx");
const tabs = read("src/components/admin/settings-tabs.tsx") + read("src/lib/admin-tabs.ts");
const css = read("src/styles.css");
const api = read("src/content/admin-api.ts");

const SECTIONS = ["Site identity", "Logo & icon", "Social links", "Analytics and consent", "AI publishing limit", "Access"];

test("t217 settings: every existing section is still there, each in exactly one tab panel", () => {
  for (const s of SECTIONS) assert.equal(settings.split(s === "Access" ? "<h2>Access</h2>" : `<legend>${s}</legend>`).length - 1, 1, s);
  assert.match(settings, /<ShareSettingsEditor/);
  assert.match(settings, /<HeadCodeCards[\s\S]*?onSaved=\{\(customHead, names\) => \{\s*patch\(\{ customHead \}\);\s*setHeadNames\(names\);/);
  const panels = [...settings.matchAll(/tabPanelProps\(P, "([a-z]+)", tab\)/g)].map((m) => m[1]);
  const ids = [...settings.matchAll(/\{ id: "([a-z]+)", label:/g)].map((m) => m[1]);
  assert.deepEqual(panels, ids);
  assert.equal(ids.length, 6);
});

test("t217 settings: every field binding from before is preserved", () => {
  for (const b of [
    "patch({ name:", "patch({ title:", "patch({ description:", "patch({ publisher:", "analytics: { ...site.analytics, enabled", "measurementId: e.target.value",
    "patch({ socials:", "onChange={(share) => patch({ share })}", "aiDailyPublishLimit: Math.max(", "patch({ logoMediaId:", "patch({ faviconMediaId:", "patch({ defaultOgMediaId:", "isRootSocialUrl",
  ])
    assert.ok(settings.includes(b), b);
});

test("t217 settings: hidden panels stay mounted (values kept and saved); invalid hidden field opens its tab", () => {
  assert.match(tabs, /hidden: id !== active/);
  assert.doesNotMatch(settings, /tab === "[a-z]+" \?/, "no conditional unmount of panels");
  assert.match(settings, /onInvalidCapture/);
  assert.match(settings, /reportValidity/);
  assert.match(css, /\.adm-tabpanel\[hidden\] \{ display: none; \}/);
});

test("t217 tabs: accessible tablist with roving focus and keyboard", () => {
  for (const s of ['role="tablist"', 'role="tab"', "aria-selected={selected}", "aria-controls=", "tabIndex={selected ? 0 : -1}", "ArrowRight", "ArrowLeft", "Home", "End", "tabIndexForKey("]) assert.ok(tabs.includes(s), s);
  assert.match(tabs, /role: "tabpanel"/);
  assert.match(tabs, /"aria-labelledby"/);
});

test("t217 tabs: horizontal overflow scrolls on narrow/tablet, tabs never wrap or shrink", () => {
  const rule = css.match(/\.adm-tabs \{[^}]*\}/)![0];
  assert.match(rule, /overflow-x: auto/);
  assert.match(css, /\.adm-tabs__tab \{[^}]*flex: 0 0 auto;[^}]*white-space: nowrap/);
});

test("t217 homepage: no persistent mini preview; Preview button opens a dialog with the real renderer", () => {
  assert.doesNotMatch(homepage, /<iframe/);
  assert.doesNotMatch(homepage, /adm-preview"/);
  assert.match(homepage, /onClick=\{\(\) => setPreviewOpen\(true\)\}[\s\S]*?Preview/);
  assert.match(dialog, /src="\/preview\/home"/);
  assert.match(dialog, /showModal\(\)/);
  assert.match(dialog, /Unsaved/);
  assert.match(dialog, /\{open \? \(\s*<iframe/, "frame only exists while open");
  assert.match(dialog, /postMessage\(\s*\{ type: "dypol-home-draft", draft, id \},\s*window\.location\.origin,?\s*\)/);
  assert.doesNotMatch(css, /@media \(min-width: 1200px\) \{ \.adm-builder \{ grid-template-columns/);
});

test("t217 homepage: draft is memory-only (no storage, cookies, URL, autosave) and is dropped on bfcache restore", () => {
  for (const src of [homepage, dialog]) {
    assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|document\.cookie|serviceWorker|history\.(push|replace)State|useBlocker|beforeunload/);
    assert.doesNotMatch(src, /adminSaveSettings|form\.save\(/);
  }
  assert.match(homepage, /event\.persisted\) window\.location\.reload\(\)/);
  assert.match(homepage, /useSiteForm\(data\.site\)/);
});

test("t217 preview server fn is read-only (no DB write, no cache bump)", () => {
  const fn = api.slice(api.indexOf("export const adminHomePreview"), api.indexOf("// ---------- pages"));
  assert.match(fn, /await guard\(\)/);
  assert.doesNotMatch(fn, /writeGuard|save|bump|update|insert|invalidate|revalidate|put\(/i);
});

import { homeDraftPayload, tabFromPanelId, tabIndexForKey, tabPanelProps } from "./admin-tabs.ts";

test("t217 tab keyboard transitions wrap and ignore other keys", () => {
  assert.equal(tabIndexForKey("ArrowRight", 0, 6), 1);
  assert.equal(tabIndexForKey("ArrowRight", 5, 6), 0);
  assert.equal(tabIndexForKey("ArrowLeft", 0, 6), 5);
  assert.equal(tabIndexForKey("Home", 4, 6), 0);
  assert.equal(tabIndexForKey("End", 1, 6), 5);
  assert.equal(tabIndexForKey("Enter", 1, 6), null);
  assert.equal(tabIndexForKey("a", 1, 6), null);
  assert.equal(tabIndexForKey("ArrowRight", 0, 0), null);
});

test("t217 panel props: only the active panel is visible; ids pair tab<->panel; invalid field maps back to its tab", () => {
  const ids = ["general", "social", "sharing", "tracking", "publishing", "access"];
  for (const active of ids) {
    const visible = ids.filter((id) => !tabPanelProps("settings", id, active).hidden);
    assert.deepEqual(visible, [active]);
  }
  const p = tabPanelProps("settings", "sharing", "general");
  assert.equal(p.id, "settings-panel-sharing");
  assert.equal(p["aria-labelledby"], "settings-tab-sharing");
  assert.equal(tabFromPanelId("settings", p.id), "sharing");
  assert.equal(tabFromPanelId("settings", "settings-panel-"), null);
  assert.equal(tabFromPanelId("settings", "other-panel-x"), null);
  assert.equal(tabFromPanelId("settings", undefined), null);
});

test("t217 preview payload carries only homepage-render fields, never sidebar/share/head/analytics", () => {
  const site = { home: { blocks: [{ type: "latest" }] }, trending: { x: 1 }, labels: { a: "b" }, customHead: "<script>", analytics: { measurementId: "G-1" }, share: {}, articleSidebar: {} };
  assert.deepEqual(Object.keys(JSON.parse(homeDraftPayload(site))), ["home", "trending", "labels"]);
});

test("t217 preview handshake: frame announces readiness after its listener is attached; dialog answers with the draft", () => {
  const frame = read("src/routes/preview/home.tsx");
  const add = frame.indexOf('window.addEventListener("message", onMessage)');
  const ready = frame.indexOf('reply({ type: "dypol-home-ready" })');
  assert.ok(add > 0 && ready > add, "ready is posted after the listener exists");
  assert.match(frame, /reply\(\{ type: "dypol-home-ready" \}\)/);
  assert.match(dialog, /isTrustedMessage\(event, origin, win, "dypol-home-ready"\)/);
  assert.match(dialog, /"dypol-home-ready"\)\) send\(\)/);
});

import { isTrustedMessage, PREVIEW_INITIAL, previewReducer } from "./home-preview-protocol.ts";

test("t217 preview loading gate: hidden until the latest draft is acked; late acks ignored; error only for the latest", () => {
  let s = previewReducer(PREVIEW_INITIAL, { type: "sent", id: 1 });
  assert.equal(s.status, "loading");
  s = previewReducer(s, { type: "sent", id: 2 });
  s = previewReducer(s, { type: "applied", id: 1 });
  assert.equal(s.status, "loading", "ack for an older draft does not reveal stale content");
  s = previewReducer(s, { type: "failed", id: 1 });
  assert.equal(s.status, "loading", "late error ignored");
  s = previewReducer(s, { type: "applied", id: 2 });
  assert.equal(s.status, "ready");
  s = previewReducer(s, { type: "sent", id: 3 });
  assert.equal(s.status, "ready", "later edits keep the current render visible");
  s = previewReducer(s, { type: "timeout", id: 3 });
  assert.equal(s.status, "ready");
  s = previewReducer(s, { type: "reset" });
  assert.equal(s.status, "loading", "reopen hides again until acked");
  s = previewReducer(s, { type: "sent", id: 4 });
  s = previewReducer(s, { type: "timeout", id: 4 });
  assert.equal(s.status, "error", "never loading forever");
});

test("t217 preview messages: same origin AND exact frame window AND type", () => {
  const win = {};
  const ok = { origin: "https://a.test", source: win, data: { type: "dypol-home-applied" } };
  assert.ok(isTrustedMessage(ok, "https://a.test", win, "dypol-home-applied"));
  assert.ok(!isTrustedMessage({ ...ok, origin: "https://evil.test" }, "https://a.test", win, "dypol-home-applied"));
  assert.ok(!isTrustedMessage({ ...ok, source: {} }, "https://a.test", win, "dypol-home-applied"));
  assert.ok(!isTrustedMessage(ok, "https://a.test", undefined, "dypol-home-applied"));
  assert.ok(!isTrustedMessage({ ...ok, data: null }, "https://a.test", win, "dypol-home-applied"));
  assert.ok(!isTrustedMessage(ok, "https://a.test", win, "dypol-home-ready"));
});

test("t217 frame acks only after commit and reports errors; dialog gates the frame", () => {
  const frame = read("src/routes/preview/home.tsx");
  assert.match(frame, /useEffect\(\(\) => \{\s*if \(data\.ack !== undefined[\s\S]*?"dypol-home-applied", id: data\.ack/);
  assert.match(frame, /"dypol-home-error", id/);
  assert.match(dialog, /aria-busy=\{state\.status === "loading"\}/);
  assert.match(dialog, /Retry/);
  assert.match(css, /iframe\[data-state="loading"\][^{]*\{ visibility: hidden; \}/);
});
