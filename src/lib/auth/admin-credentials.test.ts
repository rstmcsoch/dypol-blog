import assert from "node:assert/strict";
import { test } from "node:test";
import {
  base32Decode, base32Encode, decryptTotpSecret, encryptTotpSecret, generateRecoveryCodes,
  generateTotpSecret, hashPassword, hashRecoveryCode, issueChallenge, looksLikeRecoveryCode,
  normalizeRecoveryCode, otpauthUri, PBKDF2_ITERATIONS, totpCode, validPassword, validUsername, verifyChallenge,
  verifyPassword, verifyTotp,
} from "./admin-credentials.ts";

test("password hashing verifies, rejects wrong passwords and tampered hashes", async () => {
  const stored = await hashPassword("correct horse battery staple");
  assert.match(stored, /^pbkdf2-sha256\$100000\$/);
  assert.equal(await verifyPassword("correct horse battery staple", stored), true);
  assert.equal(await verifyPassword("correct horse battery staple!", stored), false);
  assert.equal(await verifyPassword("correct horse battery staple", stored.replace(/.$/, "A")), false);
  assert.equal(await verifyPassword("x", "not-a-hash"), false);
  const again = await hashPassword("correct horse battery staple");
  assert.notEqual(again, stored); // fresh salt every time
});

// Regression (t81): Workers WebCrypto rejects PBKDF2 above 100,000
// iterations — the original 600,000 shipped and failed live in prod.
test("pbkdf2 iteration count stays within the Workers WebCrypto cap", async () => {
  assert.ok(PBKDF2_ITERATIONS <= 100_000, `configured ${PBKDF2_ITERATIONS}`);
  assert.equal(PBKDF2_ITERATIONS, 100_000);
  const stored = await hashPassword("iteration cap regression check");
  const embedded = Number(stored.split("$")[1]);
  assert.ok(embedded <= 100_000, `stored hash embeds ${embedded}`);
  assert.equal(embedded, PBKDF2_ITERATIONS); // verify() must read this back, not a hardcoded count
  assert.equal(await verifyPassword("iteration cap regression check", stored), true);
});

test("password + username policy", () => {
  assert.equal(validPassword("short"), false);
  assert.equal(validPassword("twelve chars!"), true);
  assert.equal(validUsername("rustam"), true);
  assert.equal(validUsername("Ru"), false);
  assert.equal(validUsername("bad name"), false);
});

// RFC 6238 Appendix B times (SHA-1, secret = ASCII "12345678901234567890");
// expected values cross-verified against pyotp (authenticator-app semantics).
test("totp matches RFC 6238 vectors", async () => {
  const secret = new TextEncoder().encode("12345678901234567890");
  const vectors: [number, string][] = [
    [59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"],
    [1234567890, "89005924"], [2000000000, "69279037"], [20000000000, "65353130"],
  ];
  for (const [at, expected8] of vectors) {
    assert.equal(await totpCode(secret, at, 8), expected8, `t=${at}`);
  }
});

test("totp verify accepts ±1 step, rejects other codes", async () => {
  const { secret, bytes } = generateTotpSecret();
  const now = 1_700_000_000;
  const current = await totpCode(bytes, now);
  const prev = await totpCode(bytes, now - 30);
  const far = await totpCode(bytes, now - 120);
  assert.equal(await verifyTotp(secret, current, now), true);
  assert.equal(await verifyTotp(secret, prev, now), true);
  assert.equal(await verifyTotp(secret, far, now), false);
  assert.equal(await verifyTotp(secret, "abcdef", now), false);
  assert.equal(await verifyTotp("!!!not-base32!!!", current, now), false);
});

test("base32 round-trips and otpauth URI is well-formed", () => {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
  const uri = otpauthUri("JBSWY3DPEHPK3PXP", "rustam");
  assert.match(uri, /^otpauth:\/\/totp\/DYPOL%20Blog%3Arustam\?/);
  assert.match(uri, /issuer=DYPOL\+Blog/);
});

test("totp secret encryption round-trips; wrong key material cannot decrypt", async () => {
  const stored = await encryptTotpSecret("key-material-a", "JBSWY3DPEHPK3PXP");
  assert.notEqual(stored, "JBSWY3DPEHPK3PXP");
  assert.equal(await decryptTotpSecret("key-material-a", stored), "JBSWY3DPEHPK3PXP");
  assert.equal(await decryptTotpSecret("key-material-b", stored), null);
  assert.equal(await decryptTotpSecret("key-material-a", "garbage"), null);
});

test("recovery codes: format, normalization, hashing", async () => {
  const codes = generateRecoveryCodes(10);
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const code of codes) {
    assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    assert.equal(looksLikeRecoveryCode(code), true);
    assert.equal(normalizeRecoveryCode(code.toLowerCase()), code.replace("-", ""));
    assert.equal(await hashRecoveryCode(code), await hashRecoveryCode(code.toLowerCase().replace("-", " ")));
  }
  assert.equal(looksLikeRecoveryCode("123456"), false);
});

test("pending-2fa challenge: verifies, expires, tamper-proof", async () => {
  const now = 1_700_000_000;
  const value = await issueChallenge("desk-key", 7, now);
  assert.deepEqual(await verifyChallenge("desk-key", value, now + 60), { ok: true, userId: 7 });
  assert.equal((await verifyChallenge("desk-key", value, now + 301)).ok, false);
  assert.equal((await verifyChallenge("other-key", value, now)).ok, false);
  assert.equal((await verifyChallenge("desk-key", value.replace(/.$/, "0"), now)).ok, false);
  assert.equal((await verifyChallenge("desk-key", "junk", now)).ok, false);
});
