// t214: cron dispatch + clean-up core with a fake clock and an in-memory compare-and-swap store.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dispatchScheduled, EVENTS_CLEANUP_CRON } from "./scheduled.ts";
import { christmasEvent, endOfDateIST, parseEvents, purgeDeadline, startOfDateIST, stampEdits, sweepStore, type EventsStore, type SiteEvent } from "./events.ts";

const ev = (id: string, start: string, end: string, over: Partial<SiteEvent> = {}): SiteEvent => ({
  ...christmasEvent(2026), id, name: id, theme: "custom", enabled: true,
  startsAt: start ? startOfDateIST(start)! : "", endsAt: end ? endOfDateIST(end)! : "", ...over,
});
function memStore(initial: string | null, beforeSwap?: (s: { value: string | null }) => void) {
  const state = { value: initial, writes: 0 };
  const store: EventsStore = {
    read: async () => state.value,
    swap: async (expected, next) => {
      beforeSwap?.(state);
      if (state.value !== expected) return false;
      state.value = next;
      state.writes += 1;
      return true;
    },
  };
  return { state, store };
}

test("cron: only the events schedule runs, with the trigger's scheduledTime as the clock", async () => {
  const calls: number[] = [];
  const deps = { sweepEvents: async (now: number) => (calls.push(now), 2), log: () => {} };
  assert.deepEqual(await dispatchScheduled(EVENTS_CLEANUP_CRON, 1_000, deps), { ran: ["events-cleanup"], removed: 2 });
  assert.deepEqual(await dispatchScheduled("0 0 * * *", 2_000, deps), { ran: [], removed: 0 });
  assert.deepEqual(calls, [1_000]);
  const failing = await dispatchScheduled(EVENTS_CLEANUP_CRON, 3_000, { sweepEvents: async () => { throw new Error("db down"); }, log: () => {} });
  assert.equal(failing.removed, 0);
});

test("hourly sweep: deletes only past day 7, keeps recent/open-ended/undated/future, no write when nothing due", async () => {
  const cfg = { events: [ev("old", "2026-10-01", "2026-10-20"), ev("recent", "2026-11-01", "2026-11-05"), ev("open", "2026-10-01", ""), ev("undated", "", "", { enabled: false }), ev("future", "2026-12-01", "2026-12-03")] };
  const { state, store } = memStore(JSON.stringify(cfg));
  const deadline = purgeDeadline(cfg.events[1]!)!; // 13 Nov 00:00 IST
  assert.deepEqual(await sweepStore(store, Date.parse("2026-11-08T04:00:00Z")), { removed: ["old"], conflict: false });
  assert.equal(state.writes, 1);
  assert.deepEqual(await sweepStore(store, deadline - 1), { removed: [], conflict: false });
  assert.equal(state.writes, 1, "no write when nothing is due");
  assert.deepEqual(await sweepStore(store, deadline), { removed: ["recent"], conflict: false });
  const left = JSON.parse(state.value!).events.map((e: SiteEvent) => e.id);
  assert.deepEqual(left, ["open", "undated", "future"]);
  // the sweep never stamps or changes the clocks of rows it keeps
  for (const e of JSON.parse(state.value!).events) assert.equal(e.editedAt, undefined);
  assert.deepEqual(await sweepStore(store, Date.parse("2099-01-01T00:00:00Z")), { removed: ["future"], conflict: false });
  assert.deepEqual(JSON.parse(state.value!).events.map((e: SiteEvent) => e.id), ["open", "undated"]);
});

test("CAS: an admin edit landing between read and write wins; the edit's fresh grace is honoured next run", async () => {
  const stale = { events: [ev("e", "2026-10-01", "2026-10-20")] };
  const now = Date.parse("2026-11-08T04:00:00Z");
  const edited = stampEdits(parseEvents({ events: [{ ...stale.events[0]!, message: "keep me" }] }, stale), stale, now - 60_000);
  let raced = false;
  const { state, store } = memStore(JSON.stringify(stale), (s) => {
    if (!raced) { raced = true; s.value = JSON.stringify(edited); }
  });
  assert.deepEqual(await sweepStore(store, now), { removed: [], conflict: true });
  assert.equal(JSON.parse(state.value!).events[0].message, "keep me");
  assert.deepEqual(await sweepStore(store, now), { removed: [], conflict: false }, "edited 1 min ago → 7 more days");
  assert.deepEqual((await sweepStore(store, now - 60_000 + 7 * 86_400_000)).removed, ["e"]);
});

test("wiring: worker entry keeps the TanStack fetch handler and adds scheduled; wrangler cron matches", () => {
  const entry = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  assert.match(entry, /import handler from "@tanstack\/react-start\/server-entry"/);
  assert.match(entry, /return handler\.fetch\(\.\.\.args\)/);
  assert.match(entry, /async scheduled\(/);
  const wr = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(wr, /"main": "src\/server\.ts"/);
  assert.ok(wr.includes(`"triggers": { "crons": ["*/5 * * * *", "${EVENTS_CLEANUP_CRON}"] }`)); // pre-existing prod cron kept
  assert.equal((wr.match(/"crons"/g) ?? []).length, 1);
});
