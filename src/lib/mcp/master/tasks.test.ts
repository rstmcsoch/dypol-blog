import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPendingUpdate,
  assertTransition,
  canProfileWorkTasks,
  canTransition,
  isTerminal,
  isTaskState,
} from "./tasks.ts";

test("task lifecycle follows pending → claimed → in_progress → completed/failed/cancelled", () => {
  assert.equal(isTaskState("pending"), true);
  assert.equal(isTaskState("done"), false);
  assert.equal(canTransition("pending", "claimed"), true);
  assert.equal(canTransition("pending", "completed"), false);
  assert.equal(canTransition("claimed", "in_progress"), true);
  assert.equal(canTransition("claimed", "pending"), true, "unclaim returns to pending");
  assert.equal(canTransition("in_progress", "completed"), true);
  assert.equal(canTransition("in_progress", "failed"), true);
  assert.equal(canTransition("completed", "pending"), false);
  assert.equal(isTerminal("completed"), true);
  assert.equal(isTerminal("pending"), false);
  assert.throws(() => assertTransition("pending", "completed"));
  assert.throws(() => assertPendingUpdate("claimed"));
  assert.doesNotThrow(() => assertPendingUpdate("pending"));
});

test("paused or disabled profiles cannot claim work; the task stays pending", () => {
  assert.deepEqual(canProfileWorkTasks({ enabled: true, paused: false }), { ok: true });
  assert.match((() => { const r = canProfileWorkTasks({ enabled: true, paused: true }); assert.equal(r.ok, false); return r.ok ? "" : r.error; })(), /paused/);
  assert.match((() => { const r = canProfileWorkTasks({ enabled: false, paused: false }); assert.equal(r.ok, false); return r.ok ? "" : r.error; })(), /disabled/);
  assert.match((() => { const r = canProfileWorkTasks({ enabled: false, paused: true }); assert.equal(r.ok, false); return r.ok ? "" : r.error; })(), /disabled|paused/);
});
