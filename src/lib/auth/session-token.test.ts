import assert from "node:assert/strict";
import test from "node:test";
import { issueSession, SESSION_TTL_SECONDS, sessionKey, tokenMatches, verifySession } from "./session-token.ts";
import { checkSignIn, clientKey, SIGNIN_LIMIT } from "./sign-in-limit.ts";

const TOKEN = "token-aaaaaaaaaaaaaaaa";
const key = sessionKey(TOKEN, "secret-one");

test("a fresh session verifies and carries issued-at, expiry and a nonce", async () => {
  const now = 1_800_000_000;
  const value = await issueSession(key, now);
  assert.match(value, /^v1\.\d+\.\d+\.[0-9a-f]{32}\.[0-9a-f]{64}$/);
  const check = await verifySession(key, value, now + 10);
  assert.deepEqual(check, { ok: true, issuedAt: now, expiresAt: now + SESSION_TTL_SECONDS });
  assert.notEqual(value, await issueSession(key, now), "nonce makes each session unique");
});

test("rotating ADMIN_SESSION_SECRET or ADMIN_TOKEN invalidates old sessions", async () => {
  const value = await issueSession(key);
  assert.deepEqual(await verifySession(sessionKey(TOKEN, "secret-two"), value), { ok: false, reason: "signature" });
  assert.deepEqual(await verifySession(sessionKey("token-bbbbbbbbbbbbbbbb", "secret-one"), value), { ok: false, reason: "signature" });
  assert.deepEqual(await verifySession(sessionKey(TOKEN, undefined), value), { ok: false, reason: "signature" });
});

test("expiry is enforced server-side and fields cannot be tampered with", async () => {
  const now = 1_800_000_000;
  const value = await issueSession(key, now);
  assert.deepEqual(await verifySession(key, value, now + SESSION_TTL_SECONDS), { ok: false, reason: "expired" });
  const [v, iat, , nonce, mac] = value.split(".");
  const extended = [v, iat, String(now + 10 * SESSION_TTL_SECONDS), nonce, mac].join(".");
  assert.deepEqual(await verifySession(key, extended, now + 5), { ok: false, reason: "signature" });
  const longLived = await issueSession(key, now, SESSION_TTL_SECONDS * 3);
  assert.deepEqual(await verifySession(key, longLived, now + 5), { ok: false, reason: "expired" });
  assert.deepEqual(await verifySession(key, await issueSession(key, now + 3600), now), { ok: false, reason: "future" });
  for (const bad of ["", "0".repeat(64), "v1.1.2.3.4", "v2." + value.slice(3)]) {
    assert.equal((await verifySession(key, bad, now)).ok, false);
  }
});

test("token comparison accepts only the exact token", async () => {
  assert.equal(await tokenMatches(TOKEN, TOKEN, key), true);
  assert.equal(await tokenMatches(TOKEN + "x", TOKEN, key), false);
  assert.equal(await tokenMatches("", TOKEN, key), false);
});

function fakeLimiter(limit: number) {
  const counts = new Map<string, number>();
  return {
    counts,
    async limit({ key }: { key: string }) {
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return { success: n <= limit };
    },
  };
}

test("sign-in limit: N attempts per IP, then 429 with Retry-After; IPs are separate", async () => {
  const limiter = fakeLimiter(SIGNIN_LIMIT);
  const a = clientKey(new Headers({ "cf-connecting-ip": "203.0.113.7" }));
  const b = clientKey(new Headers({ "cf-connecting-ip": "198.51.100.2" }));
  for (let i = 0; i < SIGNIN_LIMIT; i += 1) assert.deepEqual(await checkSignIn(limiter, a), { allowed: true });
  assert.deepEqual(await checkSignIn(limiter, a), { allowed: false, retryAfter: 60 });
  assert.deepEqual(await checkSignIn(limiter, b), { allowed: true });
  assert.equal(clientKey(new Headers()), "signin:unknown");
});

test("sign-in limit fails closed when the binding is missing", async () => {
  assert.deepEqual(await checkSignIn(undefined, "signin:x"), { allowed: false, retryAfter: 60 });
});
