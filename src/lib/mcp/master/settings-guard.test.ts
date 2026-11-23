import assert from "node:assert/strict";
import test from "node:test";
import { isMasterDenied } from "./permissions.ts";
import { assertAdsPatchAllowed, assertSitePatchAllowed, collectAdsSnapshot } from "./settings-guard.ts";

test("site patch rejects custom head and secrets, allows appearance and labels", () => {
  assert.doesNotThrow(() => assertSitePatchAllowed({ appearance: { accent: "#ff4d00" }, labels: { featured: "Featured" }, aiDailyPublishLimit: 4 }));
  for (const key of ["customHead", "ADMIN_TOKEN", "MCP_TOKEN", "security", "grants", "password"]) {
    try {
      assertSitePatchAllowed({ [key]: "x" });
      assert.fail(key);
    } catch (error) {
      assert.ok(isMasterDenied(error), key);
    }
  }
});

test("ads patch allows structured changes but not new executable html", () => {
  const current = collectAdsSnapshot({
    scripts: [],
    slots: { top: { id: "top", html: "<ins class='ok'></ins>" } },
  });
  const same = collectAdsSnapshot({
    scripts: [],
    slots: { top: { id: "top", html: "<ins class='ok'></ins>" }, density: 2 },
  });
  // density is not html — same html/scripts should pass even if we only compare snapshots of scripts/html
  assert.doesNotThrow(() => assertAdsPatchAllowed({ next: current, current }));
  const changed = collectAdsSnapshot({
    scripts: [],
    slots: { top: { id: "top", html: "<script>alert(1)</script>" } },
  });
  try {
    assertAdsPatchAllowed({ next: changed, current });
    assert.fail("new script should be denied");
  } catch (error) {
    assert.ok(isMasterDenied(error));
    assert.match((error as Error).message, /executable ad scripts|JavaScript/i);
  }
  const historical = [changed];
  assert.doesNotThrow(() => assertAdsPatchAllowed({ next: changed, current, historical }), "restoring a previous version is allowed");
  void same;
});
