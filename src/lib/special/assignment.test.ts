/** t178/t179: exclusive Normal/Special profile assignment + the legacy-settings migration. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ASSIGNED_NORMAL_MESSAGE, ASSIGNED_SPECIAL_MESSAGE, DEFAULT_SPECIAL_SETTINGS, assignmentOf, normalizeSpecialSettings, pruneAssignments,
  specialModeFor, specialSettingsSchema, withAssignment, type SpecialSettings,
} from "./settings.ts";
import { applySpecialTools, SPECIAL_OFF_MESSAGE, type SpecialHandlers } from "./mcp-wiring.ts";
import type { ToolDefinition, ToolResult } from "../mcp/protocol.ts";

const on = (patch: Partial<SpecialSettings> = {}): SpecialSettings => ({ ...structuredClone(DEFAULT_SPECIAL_SETTINGS), enabled: true, eligibleCategoryIds: ["energy"], ...patch });

// ---------- migration of the default ----------

test("migration: a legacy row with nothing selected (old 'all profiles') assigns NO profile to Special", () => {
  const legacy = { enabled: true, profileIds: [], eligibleCategoryIds: ["energy"] };
  const n = normalizeSpecialSettings(legacy);
  assert.deepEqual(n.profileIds, []);
  assert.equal(n.profileAssignment, "exclusive");
  for (const id of ["default", "p12345678", "mistral"]) {
    assert.equal(assignmentOf(n, id), "normal");
    assert.equal(specialModeFor(n, id).on, false, `${id} keeps writing normal articles only`);
  }
});

test("migration: a legacy non-empty list is NOT carried over (it would silently stop normal automation)", () => {
  const n = normalizeSpecialSettings({ enabled: true, profileIds: ["mistral"], eligibleCategoryIds: ["energy"] });
  assert.deepEqual(n.profileIds, []);
  assert.equal(assignmentOf(n, "mistral"), "normal");
});

test("migration: the production state (row absent or Special off, nothing selected) stays all-Normal", () => {
  for (const raw of [undefined, null, {}, { enabled: false, profileIds: [] }]) {
    const n = normalizeSpecialSettings(raw);
    assert.deepEqual(n.profileIds, []);
    assert.equal(n.enabled, false);
  }
  assert.deepEqual(DEFAULT_SPECIAL_SETTINGS.profileIds, []);
  assert.equal(DEFAULT_SPECIAL_SETTINGS.profileAssignment, "exclusive");
});

test("an exclusive row keeps its assignments; the schema requires the marker", () => {
  const n = normalizeSpecialSettings({ ...on(), profileIds: ["mistral"], profileAssignment: "exclusive" });
  assert.deepEqual(n.profileIds, ["mistral"]);
  assert.equal(specialSettingsSchema.safeParse({ ...on(), profileAssignment: undefined }).success, false);
  assert.equal(specialSettingsSchema.safeParse(on({ profileIds: ["a"] })).success, true);
});

// ---------- exclusivity rules ----------

test("each profile is Normal or Special, never both; none selected = nobody writes specials", () => {
  const s = on({ profileIds: ["mistral"] });
  assert.equal(assignmentOf(s, "mistral"), "special");
  assert.equal(assignmentOf(s, "gemini"), "normal");
  assert.equal(specialModeFor(s, "mistral").on, true);
  const g = specialModeFor(s, "gemini");
  assert.equal(g.on, false);
  assert.equal(!g.on && g.reason, ASSIGNED_NORMAL_MESSAGE);
  assert.equal(specialModeFor(on(), "gemini").on, false);
  assert.equal(specialModeFor({ ...s, enabled: false }, "mistral").on, false, "assigned but Special off: still no specials");
});

test("withAssignment moves one profile between sections without duplicates", () => {
  assert.deepEqual(withAssignment([], "m", "special"), ["m"]);
  assert.deepEqual(withAssignment(["m"], "m", "special"), ["m"]);
  assert.deepEqual(withAssignment(["a", "m", "a"], "m", "normal"), ["a"]);
  assert.deepEqual(withAssignment(["a"], "m", "normal"), ["a"]);
  assert.deepEqual(withAssignment(["a"], "b", "special"), ["a", "b"]);
});

test("pruneAssignments drops deleted profiles", () => {
  assert.deepEqual(pruneAssignments(["a", "gone", "b", "a"], ["a", "b", "c"]), ["a", "b"]);
  assert.deepEqual(pruneAssignments(["gone"], []), []);
});

// ---------- MCP enforcement ----------

function tools(calls: unknown[]): ToolDefinition[] {
  const mk = (name: string): ToolDefinition => ({
    name, title: name, description: name, inputSchema: { type: "object", properties: { title: { type: "string" } } },
    run: async (args) => { calls.push([name, args]); return { ok: true, data: { name } } as ToolResult; },
  });
  return ["get_blog_settings", "list_recent_articles", "submit_article_draft", "publish_article_if_allowed", "update_article_draft", "get_article"].map(mk);
}
function handlers(log: string[], specials = new Set<string>()): SpecialHandlers {
  return {
    submitProperties: { article_type: { type: "string" } },
    submit: async () => { log.push("special-submit"); return { ok: true, data: {} }; },
    update: async () => { log.push("special-update"); return { ok: true, data: {} }; },
    isSpecial: async (id) => specials.has(id),
    view: async () => null,
    brief: async () => ({}),
    research: () => [],
  };
}
const run = (list: ToolDefinition[], name: string, args: unknown) => list.find((t) => t.name === name)!.run(args);
const listOf = (list: ToolDefinition[]) => JSON.stringify(list.map(({ run: _r, ...rest }) => rest));

test("Normal profile (the legacy default): tools/list unchanged, normal submits untouched, specials refused as 'assigned to Normal'", async () => {
  const calls: unknown[] = [];
  const implicit = applySpecialTools(tools(calls), false, handlers([]));
  const explicit = applySpecialTools(tools(calls), false, handlers([]), "normal");
  assert.equal(listOf(implicit), listOf(tools([])));
  assert.equal(listOf(explicit), listOf(tools([])));
  const args = { title: "Normal piece" };
  await run(explicit, "submit_article_draft", args);
  assert.equal((calls.at(-1) as unknown[])[1], args, "same object passed through");
  const r = await run(explicit, "submit_article_draft", { ...args, article_type: "special" });
  assert.deepEqual(r, { ok: false, error: ASSIGNED_NORMAL_MESSAGE });
  assert.match(ASSIGNED_NORMAL_MESSAGE, /assigned to Normal/);
});

test("Special-only profile: normal submits refused as 'assigned to Special'; specials route to the special handler", async () => {
  const calls: unknown[] = [];
  const log: string[] = [];
  const list = applySpecialTools(tools(calls), true, handlers(log, new Set(["sp1"])), "special");
  for (const args of [{ title: "x" }, { title: "x", article_type: "regular" }]) {
    assert.deepEqual(await run(list, "submit_article_draft", args), { ok: false, error: ASSIGNED_SPECIAL_MESSAGE });
  }
  assert.match(ASSIGNED_SPECIAL_MESSAGE, /assigned to Special/);
  assert.equal(calls.filter((c) => (c as unknown[])[0] === "submit_article_draft").length, 0, "the normal submit never ran");
  await run(list, "submit_article_draft", { title: "x", article_type: "special" });
  assert.deepEqual(log, ["special-submit"]);
  assert.equal((await run(list, "submit_article_draft", { title: "x", article_type: "odd" })).ok, false);
});

test("Special-only profile cannot edit or publish normal articles; special ones still work", async () => {
  const calls: unknown[] = [];
  const log: string[] = [];
  const list = applySpecialTools(tools(calls), true, handlers(log, new Set(["sp1"])), "special");
  assert.deepEqual(await run(list, "update_article_draft", { article_id: "n1", title: "t" }), { ok: false, error: ASSIGNED_SPECIAL_MESSAGE });
  assert.deepEqual(await run(list, "publish_article_if_allowed", { article_id: "n1" }), { ok: false, error: ASSIGNED_SPECIAL_MESSAGE });
  await run(list, "update_article_draft", { article_id: "sp1", body: "# b" });
  assert.deepEqual(log, ["special-update"]);
  const pub = await run(list, "publish_article_if_allowed", { article_id: "sp1" });
  assert.equal(pub.ok, true);
  assert.deepEqual(calls.at(-1), ["publish_article_if_allowed", { article_id: "sp1" }]);
});

test("Special-only profile while Special is Off: normal still refused, special says it is off", async () => {
  const list = applySpecialTools(tools([]), false, handlers([]), "special");
  assert.deepEqual(await run(list, "submit_article_draft", { title: "x" }), { ok: false, error: ASSIGNED_SPECIAL_MESSAGE });
  assert.deepEqual(await run(list, "submit_article_draft", { title: "x", article_type: "special" }), { ok: false, error: SPECIAL_OFF_MESSAGE });
});

test("Normal profiles keep publishing/editing normal articles exactly as before", async () => {
  const calls: unknown[] = [];
  const list = applySpecialTools(tools(calls), false, handlers([]), "normal");
  await run(list, "publish_article_if_allowed", { article_id: "n1" });
  await run(list, "update_article_draft", { article_id: "n1", title: "t" });
  assert.deepEqual(calls.map((c) => (c as unknown[])[0]), ["publish_article_if_allowed", "update_article_draft"]);
});
