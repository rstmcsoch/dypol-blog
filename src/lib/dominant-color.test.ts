import assert from "node:assert/strict";
import test from "node:test";
import { colorFromOnePixelPng, safeColor } from "./dominant-color.ts";

// 1x1 PNGs built with zlib: RGB #123456, and the same with alpha 10.
const RGB = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMQMgkDAAD4AJ3MaiF4AAAAAElFTkSuQmCC";
const RGBA = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQMgnjAgABnwCnQwQfQgAAAABJRU5ErkJggg==";

test("t147: dominant colour from a 1x1 PNG; transparent pixels give null", async () => {
  assert.equal(await colorFromOnePixelPng(new Uint8Array(Buffer.from(RGB, "base64"))), "#123456");
  assert.equal(await colorFromOnePixelPng(new Uint8Array(Buffer.from(RGBA, "base64"))), null);
  assert.equal(await colorFromOnePixelPng(new Uint8Array([1, 2, 3])), null);
});

test("t147: safeColor only accepts #rrggbb", () => {
  assert.equal(safeColor("#AABBCC"), "#aabbcc");
  assert.equal(safeColor("red;background:url(x)"), null);
  assert.equal(safeColor(null), null);
});
