import assert from "node:assert/strict";
import test from "node:test";
import { exchangeCode, issueCode, refresh } from "./auth.ts";
import { verifySession, issueSession, sessionKey } from "../auth/session-token.ts";

const TOKEN = "test-mcp-token-0123456789abcdef";

async function pkce() {
  const verifier = "v".repeat(50);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = Buffer.from(digest).toString("base64url");
  return { verifier, challenge };
}

test("SEC-001: authorization code is single-use when a consumer is wired", async () => {
  const { verifier, challenge } = await pkce();
  const used = new Set<string>();
  const consume = async (kind: string, nonce: string) => {
    const key = `${kind}:${nonce}`;
    if (used.has(key)) return false;
    used.add(key);
    return true;
  };
  const code = await issueCode(TOKEN, { clientId: "client-1", redirectUri: "https://claude.ai/cb", challenge, profile: { id: "default", version: "" } });
  const first = await exchangeCode(TOKEN, { code, clientId: "client-1", redirectUri: "https://claude.ai/cb", verifier }, undefined, consume);
  assert.ok(first?.access_token, "first exchange succeeds");
  const second = await exchangeCode(TOKEN, { code, clientId: "client-1", redirectUri: "https://claude.ai/cb", verifier }, undefined, consume);
  assert.equal(second, null, "replayed code is rejected");
});

test("SEC-001: refresh token rotates — the old one cannot be reused", async () => {
  const { verifier, challenge } = await pkce();
  const used = new Set<string>();
  const consume = async (kind: string, nonce: string) => {
    const key = `${kind}:${nonce}`;
    if (used.has(key)) return false;
    used.add(key);
    return true;
  };
  const code = await issueCode(TOKEN, { clientId: "client-1", redirectUri: "https://claude.ai/cb", challenge, profile: { id: "default", version: "" } });
  const pair = await exchangeCode(TOKEN, { code, clientId: "client-1", redirectUri: "https://claude.ai/cb", verifier }, undefined, consume);
  assert.ok(pair?.refresh_token);
  const rotated = await refresh(TOKEN, { refreshToken: pair.refresh_token, clientId: "client-1" }, undefined, undefined, consume);
  assert.ok(rotated?.refresh_token, "first refresh succeeds and rotates");
  const replayed = await refresh(TOKEN, { refreshToken: pair.refresh_token, clientId: "client-1" }, undefined, undefined, consume);
  assert.equal(replayed, null, "old refresh token is dead after rotation");
});

test("SEC-005: session verification exposes the nonce for revocation", async () => {
  const key = sessionKey("admin-token-0123456789", "session-secret");
  const token = await issueSession(key);
  const check = await verifySession(key, token);
  assert.equal(check.ok, true);
  if (check.ok) assert.match(check.nonce, /^[0-9a-f]{32}$/);
});
