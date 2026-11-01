import assert from "node:assert/strict";
import test from "node:test";
import { accentInk, appearanceCss, contrast, grey, themeColors } from "./appearance.ts";

test("grey maps lightness percent to a hex grey", () => {
  assert.equal(grey(100), "#ffffff");
  assert.equal(grey(0), "#000000");
  assert.equal(grey(8), "#141414");
});

test("default darkness 92% gives a soft #141414 night page (lighter than the old #0a0a0a)", () => {
  assert.equal(themeColors({ darkness: 92, whiteness: 100 }).dark.paper, "#141414");
  assert.equal(themeColors({ darkness: 92, whiteness: 100 }).light.paper, "#ffffff");
});

test("every allowed slider position keeps accessible contrast", () => {
  for (let darkness = 75; darkness <= 100; darkness += 1) {
    for (let whiteness = 85; whiteness <= 100; whiteness += 1) {
      const { light, dark } = themeColors({ darkness, whiteness });
      for (const c of [light, dark]) {
        assert.ok(contrast(c.ink, c.paper) >= 7, `ink ${c.ink} on ${c.paper}`);
        assert.ok(contrast(c.muted, c.paper) >= 4.5, `muted ${c.muted} on ${c.paper}`);
      }
    }
  }
});

test("out-of-range values are clamped", () => {
  assert.equal(themeColors({ darkness: 10, whiteness: 10 }).dark.paper, grey(25));
  assert.equal(themeColors({ darkness: 10, whiteness: 10 }).light.paper, grey(85));
});

test("accent ink picks the more readable of black and white", () => {
  assert.equal(accentInk("#ff4d00"), "#111111");
  assert.equal(accentInk("#1a237e"), "#ffffff");
});

test("appearanceCss only emits validated colours and covers every theme selector", () => {
  const css = appearanceCss({ darkness: 80, whiteness: 95, accent: "#00AA88", coverFallback: "minimal", accentText: "black" });
  assert.match(css, /--accent:#00aa88/);
  assert.match(css, /:root\[data-theme="dark"\]\{--paper:#333333;/);
  assert.match(css, /prefers-color-scheme: dark/);
  const evil = appearanceCss({ darkness: 90, whiteness: 100, accent: "red;}</style><script>", coverFallback: "plate" } as never);
  assert.doesNotMatch(evil, /script|red;/);
  assert.match(evil, /--accent:#ff4d00/);
});

test("t145: text on orange maps each option to day/night colours; unknown = black both", async () => {
  const { accentTextColors, ACCENT_TEXT_OPTIONS } = await import("./appearance.ts");
  assert.deepEqual(accentTextColors("black"), { light: "#111111", dark: "#111111" });
  assert.deepEqual(accentTextColors("white"), { light: "#ffffff", dark: "#ffffff" });
  assert.deepEqual(accentTextColors("black-white"), { light: "#111111", dark: "#ffffff" });
  assert.deepEqual(accentTextColors("white-black"), { light: "#ffffff", dark: "#111111" });
  assert.deepEqual(accentTextColors(undefined), { light: "#111111", dark: "#111111" });
  assert.deepEqual(accentTextColors("<script>"), { light: "#111111", dark: "#111111" });
  assert.equal(ACCENT_TEXT_OPTIONS.length, 4);
});

test("t145: appearanceCss writes --accent-ink per theme so the toggle switches it live", () => {
  const css = appearanceCss({ darkness: 92, whiteness: 100, accent: "#ff7100", coverFallback: "minimal", accentText: "black-white" });
  const [root, media, light, dark] = css.split("\n");
  assert.match(root, /--accent-ink:#111111/);
  assert.match(media, /--accent-ink:#ffffff/);
  assert.match(light, /--accent-ink:#111111/);
  assert.match(dark, /--accent-ink:#ffffff/);
  // Default (missing) = black in both modes, the original look.
  const def = appearanceCss({ darkness: 92, whiteness: 100, accent: "#ff7100", coverFallback: "minimal" } as never);
  assert.equal((def.match(/--accent-ink:#111111/g) ?? []).length, 4);
});
