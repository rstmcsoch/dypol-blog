import assert from "node:assert/strict";
import test from "node:test";
import {
  CREDENTIAL_REFS,
  DEFAULT_AUTOMATION_INPUT,
  automationActive,
  automationIdFromName,
  automationInputSchema,
  cronLooksValid,
  defaultModelFor,
  isValidTimeZone,
  mcpRunnable,
  providerNeedsBaseUrl,
  scheduleSummary,
} from "./automation.ts";

test("a default automation is safe: off, MCP-driven, drafts only, no key", () => {
  const parsed = automationInputSchema.parse(DEFAULT_AUTOMATION_INPUT);
  assert.equal(parsed.enabled, false);
  assert.equal(parsed.publishMode, "draft");
  assert.equal(parsed.mode, "mcp-connector");
  assert.equal(parsed.credentialRef, "");
  assert.equal(parsed.scheduleCron, "");
  assert.equal(automationActive(parsed).active, false);
  assert.equal(mcpRunnable(parsed), true);
  assert.equal(scheduleSummary(parsed).toLowerCase().includes("manual"), true);
});

test("two automations are independent: same defaults, different providers/keys/topics", () => {
  const a = automationInputSchema.parse({
    ...DEFAULT_AUTOMATION_INPUT,
    name: "OpenAI daily",
    enabled: true,
    mode: "server-api",
    provider: "openai",
    credentialRef: "AUTOMATION_A_KEY",
    topicIdeas: ["Edge computing in retail"],
    scheduleCron: "0 8 * * *",
    timezone: "Asia/Kolkata",
    publishMode: "draft",
  });
  const b = automationInputSchema.parse({
    ...DEFAULT_AUTOMATION_INPUT,
    name: "xAI weekly",
    enabled: true,
    mode: "server-api",
    provider: "xai",
    credentialRef: "AUTOMATION_B_KEY",
    topicIdeas: ["Machine vision on the shop floor"],
    scheduleCron: "0 9 * * 1",
    timezone: "UTC",
    publishMode: "auto",
    allowedCategoryIds: ["news"],
  });
  assert.notEqual(a.credentialRef, b.credentialRef);
  assert.notDeepEqual(a.topicIdeas, b.topicIdeas);
  assert.notEqual(a.timezone, b.timezone);
  assert.equal(automationActive(a).active, true);
  assert.equal(mcpRunnable(a), false);
});

test("validation refuses half-configured automations with clear paths", () => {
  const problems = (input: unknown) => {
    const result = automationInputSchema.safeParse(input);
    return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
  };
  assert.deepEqual(problems({ ...DEFAULT_AUTOMATION_INPUT, name: "x" }), ["name"]);
  assert.ok(problems({ ...DEFAULT_AUTOMATION_INPUT, mode: "server-api" }).includes("credentialRef"));
  assert.ok(problems({ ...DEFAULT_AUTOMATION_INPUT, scheduleCron: "0 8 * *" }).includes("scheduleCron"));
  assert.ok(problems({ ...DEFAULT_AUTOMATION_INPUT, scheduleCron: "0 8 * * *", timezone: "Mars/Olympus" }).includes("timezone"));
  assert.ok(problems({ ...DEFAULT_AUTOMATION_INPUT, mode: "server-api", provider: "openai-compatible", credentialRef: "AI_API_KEY", baseUrl: "" }).includes("baseUrl"));
  assert.ok(problems({ ...DEFAULT_AUTOMATION_INPUT, imageMode: "provider", provider: "anthropic" }).includes("imageMode"));
  assert.ok(problems({ ...DEFAULT_AUTOMATION_INPUT, publishMode: "auto", allowedCategoryIds: [] }).includes("allowedCategoryIds"));
  assert.equal(automationInputSchema.safeParse({ ...DEFAULT_AUTOMATION_INPUT, provider: "invented" }).success, false);
  assert.equal(automationInputSchema.safeParse({ ...DEFAULT_AUTOMATION_INPUT, credentialRef: "MY_KEY" }).success, false, "only documented secret names are accepted");
  assert.ok(CREDENTIAL_REFS.includes("AUTOMATION_A_KEY"));
});

test("ids are url-safe, unique and derived from the name", () => {
  assert.equal(automationIdFromName("Morning Brief — AI"), "morning-brief-ai");
  assert.equal(automationIdFromName("Morning Brief", ["morning-brief"]), "morning-brief-2");
  assert.equal(automationIdFromName("!!!"), "automation");
});

test("cron, timezone and provider helpers agree with the desk", () => {
  assert.equal(cronLooksValid("0 8 * * *"), true);
  assert.equal(cronLooksValid("*/15 * * * *"), true);
  assert.equal(cronLooksValid("0 8 * *"), false);
  assert.equal(cronLooksValid("99 * * * *"), false);
  assert.equal(isValidTimeZone("Asia/Kolkata"), true);
  assert.equal(isValidTimeZone("Nowhere/Nothing"), false);
  assert.equal(defaultModelFor("xai").length > 0, true);
  assert.equal(providerNeedsBaseUrl("openai-compatible"), true);
  assert.equal(providerNeedsBaseUrl("openai"), false);
  assert.ok(scheduleSummary({ scheduleCron: "0 8 * * *", timezone: "UTC" }).length > 0);
});
