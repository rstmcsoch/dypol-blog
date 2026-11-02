/** t183: head code entries — byte-for-byte storage, names, add/edit/delete/reorder. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkHeadCode } from "./head-html.ts";
import {
  addHeadEntry, cleanHeadNames, defaultHeadName, headEntries, headEntryKey, headNameFor, joinHeadEntries, moveHeadEntry, removeHeadEntry, replaceHeadEntry,
} from "./head-entries.ts";

const META = `<meta name="google-site-verification" content="cnBmFIzqzl0ubtj0Wd-0F5BvCxZMnaTRTrXfmVKkkhg" />`;
const CLARITY = `<script type="text/javascript">\n    (function(c,l,a,r,i,t,y){\n        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};\n        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;\n        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);\n    })(window, document, "clarity", "script", "z7ffle8eda");\n</script>`;
const POSTHOG = `<script>\n  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[]);}(document,window.posthog||[]);\n  posthog.init('phc_x',{api_host:'https://us.i.posthog.com'})\n</script>`;
const STORED = [META, CLARITY, POSTHOG].join("\n");
const ok = (r: ReturnType<typeof addHeadEntry>) => { assert.ok(!("error" in r), JSON.stringify(r)); return r as { code: string; names: Record<string, string> }; };

test("existing stored head code splits into 3 entries whose code is byte-identical; join round-trips exactly", () => {
  const e = headEntries(STORED);
  assert.deepEqual(e.map((x) => x.tag), ["meta", "script", "script"]);
  assert.deepEqual(e.map((x) => x.code), [META, CLARITY, POSTHOG]);
  assert.equal(joinHeadEntries(e.map((x) => x.code)), STORED);
  assert.equal(checkHeadCode(STORED).code, STORED, "stored value is already canonical, so nothing is rewritten");
});

test("production value (if present on the box) round-trips byte-for-byte", async () => {
  const fs = await import("node:fs");
  const f = "/workspace/t183/prod-customHead.txt";
  if (!fs.existsSync(f)) return;
  const prod = fs.readFileSync(f, "utf8");
  const e = headEntries(prod);
  assert.equal(e.length, 3);
  assert.equal(joinHeadEntries(e.map((x) => x.code)), prod);
  assert.deepEqual(e.map((x, i) => headNameFor({}, x, i)), ["Google Search Console verification", "Microsoft Clarity", "PostHog"]);
});

test("default names: GSC, Clarity, PostHog, else Custom <tag> N", () => {
  const e = headEntries(STORED);
  assert.deepEqual(e.map((x, i) => headNameFor({}, x, i)), ["Google Search Console verification", "Microsoft Clarity", "PostHog"]);
  assert.equal(defaultHeadName({ tag: "script", code: "<script>console.log(1)</script>" }, 2), "Custom script 3");
  assert.equal(headNameFor({ [headEntryKey(META)]: "My GSC" }, e[0]!, 0), "My GSC");
});

test("add appends new entries (one per tag) and keeps existing bytes and order", () => {
  const r = ok(addHeadEntry(STORED, {}, `\n  <meta name="msvalidate.01" content="ABC" />\n\n<link rel="preconnect" href="https://x.example">  `, "Bing"));
  const e = headEntries(r.code);
  assert.equal(e.length, 5);
  assert.ok(r.code.startsWith(STORED + "\n"));
  assert.equal(r.names[headEntryKey(e[3]!.code)], "Bing");
  assert.equal(r.names[headEntryKey(e[4]!.code)], "Bing (2)");
  assert.equal(r.names[headEntryKey(META)], "Google Search Console verification", "existing defaults persisted");
  assert.ok("error" in addHeadEntry(STORED, {}, "just text"));
  assert.ok("error" in addHeadEntry(STORED, {}, "   "));
});

test("edit replaces only that entry; others stay byte-identical; name editable; empty edit refused", () => {
  const r = ok(replaceHeadEntry(STORED, {}, 0, `<meta name="google-site-verification" content="NEW" />`, "GSC (new)"));
  assert.equal(r.code, [`<meta name="google-site-verification" content="NEW" />`, CLARITY, POSTHOG].join("\n"));
  assert.equal(headNameFor(r.names, headEntries(r.code)[0]!, 0), "GSC (new)");
  const keep = ok(replaceHeadEntry(STORED, { [headEntryKey(CLARITY)]: "Clarity!" }, 1, CLARITY.replace("z7ffle8eda", "zzz"), ""));
  assert.equal(headNameFor(keep.names, headEntries(keep.code)[1]!, 1), "Clarity!", "blank name keeps the old one");
  assert.match((replaceHeadEntry(STORED, {}, 1, "  ") as { error: string }).error, /Delete/);
  assert.ok("error" in replaceHeadEntry(STORED, {}, 9, META));
});

test("delete removes one entry; the rest keep bytes, order and names", () => {
  const r = ok(removeHeadEntry(STORED, {}, 1));
  assert.equal(r.code, [META, POSTHOG].join("\n"));
  assert.equal(headNameFor(r.names, headEntries(r.code)[1]!, 1), "PostHog");
  assert.equal(ok(removeHeadEntry(META, {}, 0)).code, "");
});

test("reorder: up/down swap neighbours, refused at the ends, names follow their entries", () => {
  const custom = [META, "<script>a()</script>", "<script>b()</script>"].join("\n");
  const down = ok(moveHeadEntry(custom, {}, 0, 1));
  assert.equal(down.code, ["<script>a()</script>", META, "<script>b()</script>"].join("\n"));
  const e = headEntries(down.code);
  assert.deepEqual(e.map((x, i) => headNameFor(down.names, x, i)), ["Custom script 2", "Google Search Console verification", "Custom script 3"]);
  const up = ok(moveHeadEntry(STORED, {}, 2, -1));
  assert.equal(up.code, [META, POSTHOG, CLARITY].join("\n"));
  assert.ok("error" in moveHeadEntry(STORED, {}, 0, -1));
  assert.ok("error" in moveHeadEntry(STORED, {}, 2, 1));
});

test("cleanHeadNames keeps only short string names for present entries", () => {
  const n = cleanHeadNames({ [headEntryKey(META)]: "  GSC   tag ", nope: "x", [headEntryKey(CLARITY)]: 5, [headEntryKey(POSTHOG)]: "y".repeat(200) }, STORED);
  assert.deepEqual(Object.keys(n).sort(), [headEntryKey(META), headEntryKey(POSTHOG)].sort());
  assert.equal(n[headEntryKey(META)], "GSC tag");
  assert.equal(n[headEntryKey(POSTHOG)]!.length, 80);
  assert.deepEqual(cleanHeadNames("bad", STORED), {});
});
