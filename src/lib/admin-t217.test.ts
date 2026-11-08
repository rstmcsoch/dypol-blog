import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const settings = read("src/routes/admin/settings.tsx");
const homepage = read("src/routes/admin/homepage.tsx");
const dialog = read("src/components/admin/home-preview-dialog.tsx");
const tabs = read("src/components/admin/settings-tabs.tsx");
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
  for (const s of ['role="tablist"', 'role="tab"', "aria-selected={selected}", "aria-controls=", "tabIndex={selected ? 0 : -1}", "ArrowRight", "ArrowLeft", "Home", "End"]) assert.ok(tabs.includes(s), s);
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
  assert.match(dialog, /postMessage\(\s*\{ type: "dypol-home-draft", draft \},\s*window\.location\.origin,?\s*\)/);
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
