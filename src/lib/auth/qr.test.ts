import assert from "node:assert/strict";
import { test } from "node:test";
import { qrMatrix, qrSvg } from "./qr.ts";

// Fixture generated with Nayuki's reference qrcodegen encoder (byte mode,
// EC level M, mask 0) for "HELLO WORLD" — pins the whole pipeline
// (data encoding, Reed–Solomon, interleaving, placement, format bits).
const HELLO_WORLD_MASK0 = [
  "111111100110101111111",
  "100000101100101000001",
  "101110100000101011101",
  "101110100011001011101",
  "101110101100101011101",
  "100000100100101000001",
  "111111101010101111111",
  "000000000011100000000",
  "101010100101000010010",
  "101001000110001100010",
  "100010111110110111111",
  "101100011110000010010",
  "101100111000111110100",
  "000000001111010000110",
  "111111100011000110111",
  "100000100111100100001",
  "101110101111001010100",
  "101110100001001110110",
  "101110101010101010101",
  "100000100011000010010",
  "111111101101101100111",
];

test("qr matrix matches reference encoder fixture", () => {
  const { modules, version, size } = qrMatrix("HELLO WORLD", 0);
  assert.equal(version, 1);
  assert.equal(size, 21);
  const rows = modules.map((row) => row.map((b) => (b ? "1" : "0")).join(""));
  assert.deepEqual(rows, HELLO_WORLD_MASK0);
});

test("qr picks a version that fits an otpauth URI and renders svg", () => {
  const uri = "otpauth://totp/DYPOL%20Blog%3Arustam?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=DYPOL+Blog&algorithm=SHA1&digits=6&period=30";
  const { version } = qrMatrix(uri);
  assert.ok(version >= 7 && version <= 10, `version ${version}`);
  const svg = qrSvg(uri);
  assert.match(svg, /^<svg /);
  assert.match(svg, /fill="#fff"/);
});

test("qr rejects oversized payloads", () => {
  assert.throws(() => qrMatrix("x".repeat(500)), /too large/);
});
