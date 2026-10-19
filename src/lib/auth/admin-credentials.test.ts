import assert from "node:assert/strict";
import { test } from "node:test";
import {
  base32Decode, base32Encode, decryptTotpSecret, encryptTotpSecret, generateRecoveryCodes,
  generateTotpSecret, hashPassword, hashRecoveryCode, issueChallenge, looksLikeRecoveryCode,
  normalizeRecoveryCode, otpauthUri, PBKDF2_ITERATIONS, totpCode, validPassword, validUsername, verifyChallenge,
  verifyPassword, verifyTotp, totpMatchStep, TOTP_WINDOW_STEPS, TOTP_DIAGNOSE_STEPS, confirmMismatchMessage,
} from "./admin-credentials.ts";
import { createHmac } from "node:crypto";

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

test("totp verify accepts ±2 steps (t84), rejects other codes", async () => {
  const { secret, bytes } = generateTotpSecret();
  const now = 1_700_000_000;
  const current = await totpCode(bytes, now);
  const prev = await totpCode(bytes, now - 30);
  const twoStepsBack = await totpCode(bytes, now - 60);
  const far = await totpCode(bytes, now - 120);
  assert.equal(await verifyTotp(secret, current, now), true);
  assert.equal(await verifyTotp(secret, prev, now), true);
  assert.equal(await verifyTotp(secret, twoStepsBack, now), true);
  assert.equal(await verifyTotp(secret, far, now), false);
  assert.equal(await verifyTotp(secret, "abcdef", now), false);
  assert.equal(await verifyTotp("!!!not-base32!!!", current, now), false);
});

// t84 regression net: an INDEPENDENT TOTP implementation (node:crypto
// HMAC + a from-scratch base32 decoder, the pyotp/authenticator semantics)
// must agree with the repo on freshly generated secrets, through the full
// pending path (encrypt at enrolment -> decrypt at confirm -> verify),
// at multiple times and with leading-zero codes preserved as strings.
// This is the test that fails if generate/QR/store/verify ever drift apart.
test("independent TOTP implementation agrees through the encrypt-store-verify path", async () => {
  const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const independent = (secretB32: string, atSeconds: number): string => {
    let bits = 0, value = 0; const out: number[] = [];
    for (const ch of secretB32.replace(/\s/g, "")) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
    const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(atSeconds / 30)));
    const mac = createHmac("sha1", Buffer.from(out)).update(counter).digest();
    return String(mac.readUInt32BE(mac[mac.length - 1] & 0x0f) & 0x7fffffff).padStart(10, "0").slice(-6).padStart(6, "0");
  };
  const times = [1_700_000_000, 1_790_000_123, 1_234_567_890];
  for (let i = 0; i < 25; i += 1) {
    const { secret } = generateTotpSecret();
    // enrolment stores the pending secret encrypted; confirm decrypts it back
    const restored = await decryptTotpSecret("diag-key", await encryptTotpSecret("diag-key", secret));
    assert.equal(restored, secret);
    for (const at of times) {
      const expected = independent(secret, at);
      assert.equal(await totpCode(base32Decode(secret), at), expected, `code drift secret#${i} t=${at}`);
      assert.equal(await verifyTotp(restored!, expected, at), true, `verify drift secret#${i} t=${at}`);
    }
  }
  // leading zeros survive as a 6-char string (never parsed as a number)
  const { secret, bytes } = generateTotpSecret();
  let leadingAt = 0; let leadingCode = "";
  for (let at = 1_700_000_000; at < 1_700_100_000; at += 30) {
    const c = await totpCode(bytes, at);
    if (c.startsWith("0")) { leadingAt = at; leadingCode = c; break; }
  }
  assert.ok(leadingCode.startsWith("0") && leadingCode.length === 6);
  assert.equal(await verifyTotp(secret, leadingCode, leadingAt), true);
});

test("totpMatchStep diagnoses clock skew vs wrong entry without widening acceptance", async () => {
  const { secret, bytes } = generateTotpSecret();
  const other = generateTotpSecret();
  const now = 1_700_000_000;
  assert.equal(await totpMatchStep(secret, await totpCode(bytes, now), now, TOTP_DIAGNOSE_STEPS), 0);
  assert.equal(await totpMatchStep(secret, await totpCode(bytes, now - 90), now, TOTP_DIAGNOSE_STEPS), -3);
  assert.equal(await totpMatchStep(secret, await totpCode(bytes, now + 150), now, TOTP_DIAGNOSE_STEPS), 5);
  assert.equal(await totpMatchStep(secret, await totpCode(other.bytes, now), now, TOTP_DIAGNOSE_STEPS), null);
  assert.equal(await totpMatchStep(secret, await totpCode(bytes, now - (TOTP_WINDOW_STEPS + 1) * 30), now), null, "default search stays within the accepted window");
  assert.match(confirmMismatchMessage(-3), /phone clock/);
  assert.match(confirmMismatchMessage(null), /not from the authenticator entry/);
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
