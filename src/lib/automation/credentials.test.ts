import assert from "node:assert/strict";
import test from "node:test";
import { credentialStatus, credentialSummary, fingerprint, resolveCredential } from "./credentials.ts";

const ENV = {
  AUTOMATION_A_KEY: "sk-a-0123456789abcdef",
  OPENAI_API_KEY: "sk-openai-0123456789",
  AI_API_KEY: "ai-generic",
};

test("a credential is resolved by exact name only — never by fallback", () => {
  assert.equal(resolveCredential("OPENAI_API_KEY", ENV)?.value, "sk-openai-0123456789");
  assert.equal(resolveCredential("AUTOMATION_B_KEY", ENV), null, "an unset slot stays unset");
  assert.equal(resolveCredential("", ENV), null);
  assert.equal(resolveCredential("NOT_A_SECRET", ENV), null);
  assert.equal(resolveCredential("AI_API_KEY", {}), null);
  // An automation pointing at one provider's secret must never pick up another's.
  assert.equal(resolveCredential("AUTOMATION_A_KEY", { OPENAI_API_KEY: "x" }), null);
});

test("status reports names, fingerprints and lengths — never values", async () => {
  const status = await credentialStatus(ENV);
  const openai = status.find((item) => item.name === "OPENAI_API_KEY");
  assert.equal(openai?.configured, true);
  assert.equal(openai?.length, "sk-openai-0123456789".length);
  assert.match(openai?.fingerprint ?? "", /^[0-9a-f]{8}$/);
  const missing = status.find((item) => item.name === "GEMINI_API_KEY");
  assert.equal(missing?.configured, false);
  assert.equal(missing?.fingerprint, null);
  const serialised = JSON.stringify(status);
  assert.equal(serialised.includes("sk-openai"), false, "no secret value may appear in the status payload");
});

test("fingerprints are stable and different keys differ", async () => {
  assert.equal(await fingerprint("abc"), await fingerprint("abc"));
  assert.notEqual(await fingerprint("abc"), await fingerprint("abd"));
});

test("the summary line explains the state without leaking the key", () => {
  const summary = credentialSummary("OPENAI_API_KEY", [
    { name: "OPENAI_API_KEY", configured: true, fingerprint: "deadbeef", length: 12 },
  ]);
  assert.ok(summary.includes("deadbeef"));
  assert.equal(summary.includes("sk-"), false);
  assert.ok(credentialSummary("", []).toLowerCase().includes("no credential"));
  assert.ok(credentialSummary("GEMINI_API_KEY", [{ name: "GEMINI_API_KEY", configured: false, fingerprint: null, length: null }]).includes("not set"));
  assert.ok(credentialSummary("SOMETHING_ELSE", []).includes("not a supported secret name"));
});
