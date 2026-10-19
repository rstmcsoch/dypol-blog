import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GA_MEASUREMENT_ID,
  GA_SCRIPT_URL,
  createPageViewTracker,
  gtagInitScript,
  pageViewParams,
} from "./analytics.ts";

test("GA id is the single G- measurement id used everywhere", () => {
  assert.equal(GA_MEASUREMENT_ID, "G-T1R0QJ2F0Z");
  assert.equal(GA_SCRIPT_URL, "https://www.googletagmanager.com/gtag/js?id=G-T1R0QJ2F0Z");
  assert.match(gtagInitScript, /window\.dataLayer = window\.dataLayer \|\| \[\];/);
  assert.match(gtagInitScript, /function gtag\(\)\{dataLayer\.push\(arguments\);}/);
  // Exactly one config call, for this id — the initial page_view source.
  assert.equal((gtagInitScript.match(/gtag\('config',/g) ?? []).length, 1);
  assert.ok(gtagInitScript.includes(`gtag('config', '${GA_MEASUREMENT_ID}');`));
});

test("pageViewParams maps path/location/title", () => {
  assert.deepEqual(
    pageViewParams({ path: "/articles/x", location: "https://e.com/articles/x", title: "X" }),
    {
      page_path: "/articles/x",
      page_location: "https://e.com/articles/x",
      page_title: "X",
    },
  );
});

test("tracker: initial landing path is not double-counted, later navigations are", () => {
  const t = createPageViewTracker();
  assert.equal(t.observe("/"), false, "landing: config already sent this page_view");
  assert.equal(t.observe("/"), false, "same path re-observed (StrictMode) is not a navigation");
  assert.equal(t.observe("/articles/a"), true, "client-side navigation counts");
  assert.equal(t.observe("/articles/a"), false, "duplicate observation does not double-count");
  assert.equal(t.observe("/topics/tech"), true, "next navigation counts");
  assert.equal(t.observe("/articles/a"), true, "returning to a previous path is a new view");
});
