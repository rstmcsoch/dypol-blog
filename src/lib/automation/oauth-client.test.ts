import assert from "node:assert/strict";
import test from "node:test";
import { newOauthClientId, newOauthClientSecret, OAUTH_CLIENT_ID_RE, parseAdminRedirects } from "./oauth-client.ts";

test("oauth client ids and secrets are unguessable and prefixed", () => {
  const id = newOauthClientId();
  const secret = newOauthClientSecret();
  assert.match(id, OAUTH_CLIENT_ID_RE);
  assert.match(secret, /^dyps_[0-9a-f]{48}$/);
  assert.notEqual(id, newOauthClientId());
  assert.notEqual(secret, newOauthClientSecret());
});

test("admin redirect list: exact https callbacks, rejects open redirects", () => {
  const gemini = "https://oauth-redirect.googleusercontent.com/r/abc123";
  assert.deepEqual(parseAdminRedirects([gemini, gemini, `  ${gemini}  `]), [gemini]);
  assert.deepEqual(parseAdminRedirects("https://a.example/cb\nhttps://b.example/cb\n"), ["https://a.example/cb", "https://b.example/cb"]);
  for (const bad of ["javascript:alert(1)", "http://evil.example/cb", "https://user:pass@a.example/cb", "https://a.example/cb#frag", "", "https://127.0.0.1/cb"]) {
    assert.throws(() => parseAdminRedirects([bad]), bad);
  }
  assert.throws(() => parseAdminRedirects([]));
  assert.throws(() => parseAdminRedirects(Array.from({ length: 6 }, (_, i) => `https://h${i}.example/cb`)));
});
