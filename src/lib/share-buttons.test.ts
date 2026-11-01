import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SHARE_BUTTONS, SHARE_NETWORKS, customTemplateError, normalizeShareSettings, shareHref, shareLabel } from "./share-buttons.ts";

const URL_ = "https://blog.dypol.workers.dev/articles/a-b";
const TITLE = "Tom & Jerry: 100% \"fun\"?";
const eu = encodeURIComponent(URL_);
const et = encodeURIComponent(TITLE);

test("defaults are exactly the old five buttons, same order and hrefs", () => {
  assert.deepEqual(DEFAULT_SHARE_BUTTONS.map((b) => b.kind), ["x", "linkedin", "facebook", "email", "copy"]);
  const hrefs = DEFAULT_SHARE_BUTTONS.map((b) => shareHref(b, URL_, TITLE));
  assert.deepEqual(hrefs, [
    `https://x.com/intent/post?url=${eu}&text=${et}`,
    `https://www.linkedin.com/sharing/share-offsite/?url=${eu}`,
    `https://www.facebook.com/sharer/sharer.php?u=${eu}`,
    `mailto:?subject=${et}&body=${eu}`,
    null,
  ]);
  assert.deepEqual(DEFAULT_SHARE_BUTTONS.map((b) => shareLabel(b, "Copy link")), ["X", "LinkedIn", "Facebook", "Email", "Copy link"]);
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
  assert.deepEqual(normalizeShareSettings(undefined).buttons.map((b) => b.kind), ["x", "linkedin", "facebook", "email", "copy"]);
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
  assert.deepEqual(legacy.share.buttons.map((b) => b.kind), ["x", "linkedin", "facebook", "email", "copy"]);
  const bad = { ...legacy, share: { buttons: [{ id: "c", kind: "custom", enabled: true, label: "x", template: "javascript:alert(1)" }] } };
  assert.throws(() => parseSite(bad));
  const ok = { ...legacy, share: { buttons: [{ id: "c", kind: "custom", enabled: true, label: "Mine", template: "https://e.com/?u={url}" }, { id: "w", kind: "whatsapp", enabled: false, label: "", template: "" }] } };
  assert.equal(parseSite(ok).share.buttons.length, 2);
});
