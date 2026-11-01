import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SHARE_BUTTONS, SHARE_NETWORKS, customTemplateError, normalizeShareSettings, shareHref, shareLabel } from "./share-buttons.ts";

const URL_ = "https://blog.dypol.workers.dev/articles/a-b";
const TITLE = "Tom & Jerry: 100% \"fun\"?";
const eu = encodeURIComponent(URL_);
const et = encodeURIComponent(TITLE);

test("t150: defaults are every built-in network, Copy link and Share…", () => {
  assert.deepEqual(DEFAULT_SHARE_BUTTONS.map((b) => b.kind), ["x", "linkedin", "facebook", "whatsapp", "telegram", "reddit", "threads", "bluesky", "pinterest", "hackernews", "email", "copy", "native"]);
  assert.ok(DEFAULT_SHARE_BUTTONS.every((b) => b.enabled));
  assert.equal(shareHref(DEFAULT_SHARE_BUTTONS[0], URL_, TITLE), `https://x.com/intent/post?url=${eu}&text=${et}`);
  assert.deepEqual(DEFAULT_SHARE_BUTTONS.slice(-3).map((b) => shareLabel(b, "Copy link")), ["Email", "Copy link", "Share…"]);
});

test("t150: an untouched old five-button setting migrates to the new default; edited ones are kept", () => {
  const old = ["x", "linkedin", "facebook", "email", "copy"].map((k) => ({ id: `share-${k}`, kind: k, enabled: true, label: k === "x" ? "X" : "", template: "" }));
  assert.equal(normalizeShareSettings({ buttons: old }).buttons.length, 13);
  const renamed = old.map((b) => (b.kind === "x" ? { ...b, label: "Post on X" } : b));
  assert.equal(normalizeShareSettings({ buttons: renamed }).buttons.length, 5);
  const off = old.map((b) => (b.kind === "email" ? { ...b, enabled: false } : b));
  assert.equal(normalizeShareSettings({ buttons: off }).buttons.length, 5);
  assert.equal(normalizeShareSettings({ buttons: old.slice(0, 4) }).buttons.length, 4);
});

test("every built-in network encodes url and title and is https", () => {
  for (const [kind, net] of Object.entries(SHARE_NETWORKS)) {
    const href = shareHref({ kind: kind as never, template: "" }, URL_, TITLE)!;
    if (kind !== "email") assert.match(href, /^https:\/\//, kind);
    assert.ok(href.includes(eu), kind);
    if (net.template.includes("{title}")) assert.ok(href.includes(et), kind);
    assert.ok(!href.includes(" ") && !href.includes('"'), kind);
  }
  assert.equal(shareHref({ kind: "whatsapp", template: "" }, URL_, TITLE), `https://wa.me/?text=${et}%20${eu}`);
  assert.equal(shareHref({ kind: "native", template: "" }, URL_, TITLE), null);
});

test("custom templates: http(s) only, values encoded, no script urls", () => {
  assert.equal(customTemplateError("https://example.com/s?u={url}&t={title}"), null);
  assert.equal(customTemplateError("http://example.com/{url}"), null);
  for (const bad of ["javascript:alert(1)//{url}", "data:text/html,hi", "mailto:a@b.c", "//example.com/{url}", "example.com/{url}", "", "https://a.com/ {url}", "JaVaScRiPt:alert(1)", "https://a.com/\"onmouseover=x"]) {
    assert.notEqual(customTemplateError(bad), null, bad);
    assert.equal(shareHref({ kind: "custom", template: bad }, URL_, TITLE), null, bad);
  }
  assert.equal(shareHref({ kind: "custom", template: "https://example.com/s?u={url}&t={title}" }, URL_, TITLE), `https://example.com/s?u=${eu}&t=${et}`);
  // A title that looks like a URL scheme stays encoded data.
  assert.equal(shareHref({ kind: "custom", template: "https://e.com/?t={title}" }, URL_, "javascript:x"), "https://e.com/?t=javascript%3Ax");
});

test("normalize: missing -> defaults; bad entries dropped; labels trimmed", () => {
  assert.deepEqual(normalizeShareSettings(undefined).buttons.map((b) => b.kind), DEFAULT_SHARE_BUTTONS.map((b) => b.kind));
  const n = normalizeShareSettings({
    buttons: [
      { id: "a", kind: "reddit", enabled: false, label: "  Post it  " },
      { id: "b", kind: "evil", enabled: true },
      { id: "c", kind: "custom", enabled: true, label: "Mine", template: "javascript:alert(1)" },
      { id: "d", kind: "custom", enabled: true, label: "Mine", template: "https://e.com/?u={url}" },
      { id: "a", kind: "x", enabled: true },
    ],
  });
  assert.deepEqual(n.buttons.map((b) => [b.id, b.kind, b.enabled, b.label]), [["a", "reddit", false, "Post it"], ["d", "custom", true, "Mine"]]);
  assert.deepEqual(normalizeShareSettings({ buttons: [] }).buttons, []);
});

test("site settings: legacy rows get the default share buttons; saving rejects script templates", async () => {
  const { normalizeSite, parseSite } = await import("../content/validate.ts");
  const legacy = normalizeSite({});
  assert.deepEqual(legacy.share.buttons.map((b) => b.kind), DEFAULT_SHARE_BUTTONS.map((b) => b.kind));
  const bad = { ...legacy, share: { buttons: [{ id: "c", kind: "custom", enabled: true, label: "x", template: "javascript:alert(1)" }] } };
  assert.throws(() => parseSite(bad));
  const ok = { ...legacy, share: { buttons: [{ id: "c", kind: "custom", enabled: true, label: "Mine", template: "https://e.com/?u={url}" }, { id: "w", kind: "whatsapp", enabled: false, label: "", template: "" }] } };
  assert.equal(parseSite(ok).share.buttons.length, 2);
});
