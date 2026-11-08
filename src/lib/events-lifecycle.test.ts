// t213/t214: saved-event lifecycle — Upcoming / Ongoing / Paused / Expired (kept 7 days) / deleted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EXPIRED_RETENTION_MS, christmasEvent, endOfDateIST, eventLifecycle, eventsSignature, normalizeEvents, parseEvents,
  purgeDeadline, purgeExpired, startOfDateIST, stampEdits, type SiteEvent,
} from "./events.ts";

const at = (iso: string) => Date.parse(iso);
const ev = (over: Partial<SiteEvent> = {}): SiteEvent => ({
  ...christmasEvent(2026), id: "e1", name: "Diwali", theme: "diwali", enabled: true,
  startsAt: startOfDateIST("2026-11-08")!, endsAt: endOfDateIST("2026-11-10")!, ...over,
});

test("tags: Upcoming before start, Ongoing while applied, Expired after inclusive end, Paused distinguished", () => {
  const e = ev();
  const cfg = { events: [e] };
  assert.equal(eventLifecycle(e, cfg, at("2026-11-07T18:29:59Z")), "upcoming");
  assert.equal(eventLifecycle(e, cfg, at("2026-11-07T18:30:00Z")), "ongoing");
  assert.equal(eventLifecycle(e, cfg, at("2026-11-10T18:29:59.999Z")), "ongoing"); // last ms of 10 Nov IST
  assert.equal(eventLifecycle(e, cfg, at("2026-11-10T18:30:00Z")), "expired");
  const p = { ...e, enabled: false };
  assert.equal(eventLifecycle(p, { events: [p] }, at("2026-11-09T00:00:00Z")), "paused");
  assert.equal(eventLifecycle(p, { events: [p] }, at("2026-11-12T00:00:00Z")), "expired");
  const other = ev({ id: "e2", startsAt: startOfDateIST("2026-11-09")! });
  assert.equal(eventLifecycle(e, { events: [e, other] }, at("2026-11-09T06:00:00Z")), "waiting");
  assert.equal(eventLifecycle(other, { events: [e, other] }, at("2026-11-09T06:00:00Z")), "ongoing");
});

test("exact day-7 boundary after the inclusive IST end", () => {
  const e = ev();
  const deadline = purgeDeadline(e)!;
  assert.equal(new Date(deadline).toISOString(), "2026-11-17T18:30:00.000Z"); // 18 Nov 00:00 IST = end(11 Nov 00:00 IST) + 7d
  assert.equal(purgeExpired({ events: [e] }, deadline - 1).removed.length, 0);
  assert.equal(purgeExpired({ events: [e] }, deadline).removed.length, 1);
  assert.equal(eventLifecycle(e, { events: [e] }, deadline - 1), "expired"); // shown as Expired for the whole 7 days
});

test("undated / open-ended / future events are never purged", () => {
  const far = at("2099-01-01T00:00:00Z");
  for (const e of [ev({ startsAt: "", endsAt: "" }), ev({ endsAt: "" }), ev({ startsAt: startOfDateIST("2098-01-01")!, endsAt: endOfDateIST("2098-12-31")! })]) {
    if (!e.endsAt) assert.equal(purgeDeadline(e), null);
    assert.equal(purgeExpired({ events: [e] }, e.endsAt ? Date.parse(e.endsAt) : far).removed.length, 0);
  }
  const mixed = { events: [ev({ id: "old" }), ev({ id: "open", endsAt: "" })] };
  assert.deepEqual(purgeExpired(mixed, at("2027-01-01T00:00:00Z")).config.events.map((e) => e.id), ["open"]);
});

test("meaningful edit while expired restarts 7 days; no-op save, read and preview never reset", () => {
  const stored = { events: [ev()] }; // legacy-style: no editedAt
  const t1 = at("2026-11-14T00:00:00Z"); // expired, deadline 17 Nov 18:30Z
  const noop = stampEdits(parseEvents(JSON.parse(JSON.stringify(stored)), stored), stored, t1);
  assert.equal(noop.events[0]!.editedAt, undefined);
  assert.equal(purgeDeadline(noop.events[0]!), purgeDeadline(stored.events[0]!));
  // a client cannot forge editedAt
  const forged = stampEdits({ events: [{ ...stored.events[0]!, editedAt: "2030-01-01T00:00:00.000Z" }] }, stored, t1);
  assert.equal(forged.events[0]!.editedAt, undefined);
  // reads/normalisation never stamp
  assert.equal(normalizeEvents(JSON.parse(JSON.stringify(stored))).events[0]!.editedAt, undefined);
  // real edit (message) while expired → fresh 7 days from the edit
  const edited = stampEdits({ events: [{ ...stored.events[0]!, message: "Still here" }] }, stored, t1);
  assert.equal(edited.events[0]!.editedAt, new Date(t1).toISOString());
  assert.equal(purgeDeadline(edited.events[0]!), t1 + EXPIRED_RETENTION_MS);
  assert.equal(purgeExpired(edited, at("2026-11-18T00:00:00Z")).removed.length, 0);
  assert.equal(purgeExpired(edited, t1 + EXPIRED_RETENTION_MS).removed.length, 1);
  // a second no-op keeps that stamp
  const again = stampEdits(edited, edited, t1 + 1000);
  assert.equal(again.events[0]!.editedAt, edited.events[0]!.editedAt);
  // year null vs absent is not an edit
  assert.equal(stampEdits({ events: [{ ...stored.events[0]!, year: null }] }, stored, t1).events[0]!.editedAt, undefined);
});

test("reschedule into the future → Upcoming; its new end starts the next grace", () => {
  const stored = { events: [ev()] };
  const t1 = at("2026-11-14T00:00:00Z");
  const moved = stampEdits({ events: [ev({ startsAt: startOfDateIST("2026-12-01")!, endsAt: endOfDateIST("2026-12-03")! })] }, stored, t1);
  assert.equal(eventLifecycle(moved.events[0]!, moved, t1), "upcoming");
  assert.equal(new Date(purgeDeadline(moved.events[0]!)!).toISOString(), "2026-12-10T18:30:00.000Z");
});

test("new events are stamped; strict save still rejects time-of-day", () => {
  const out = stampEdits(parseEvents({ events: [ev({ id: "new" })] }), null, at("2026-11-08T04:00:00Z"));
  assert.equal(out.events[0]!.editedAt, "2026-11-08T04:00:00.000Z");
  assert.throws(() => parseEvents({ events: [ev({ endsAt: "2026-11-10T23:59:00.000Z" })] }));
});

test("compare-and-swap: signature changes on any stored change; server uses guarded writes; no immediate delete", () => {
  const a = JSON.stringify({ events: [ev()] });
  assert.equal(eventsSignature(a), eventsSignature(a));
  assert.notEqual(eventsSignature(a), eventsSignature(a.replace("Diwali", "Diwalj")));
  assert.equal(eventsSignature(null), "none");
  const server = readFileSync(new URL("../content/events.server.ts", import.meta.url), "utf8");
  assert.match(server, /if \(eventsSignature\(storedRaw\) !== version\) throw new EventsConflictError\(\)/);
  assert.equal((server.match(/where id = \$\{EVENTS_SETTINGS_ID\} and data = \$\{(expected|storedRaw)\} returning id/g) ?? []).length, 2);
  assert.doesNotMatch(server, /on conflict \(id\) do update/);
  // every removal goes through purgeExpired (7-day deadline); nothing filters on eventStatus "ended"
  assert.doesNotMatch(server + readFileSync(new URL("./events.ts", import.meta.url), "utf8"), /filter\([^)]*=== "ended"/);
});

test("admin UI: one top form, compact saved cards, generic Add event, date-only, retention text", () => {
  const src = readFileSync(new URL("../routes/admin/events.tsx", import.meta.url), "utf8");
  assert.equal((src.match(/type="date"/g) ?? []).length, 2);
  assert.doesNotMatch(src, /datetime-local|type="time"/);
  assert.equal((src.match(/<legend>/g) ?? []).length, 1); // a single editor fieldset
  assert.match(src, /saved\.events\.map\(\(event\) =>/);
  assert.match(src, /Edit[\s\S]*Preview[\s\S]*Delete/);
  assert.match(src, /Deletes automatically on/);
  for (const tag of ["Upcoming", "Ongoing", "Paused", "Expired"]) assert.ok(src.includes(`"${tag}"`), tag);
  assert.doesNotMatch(src, /addNewYear|addFestival|Add New Year/);
  assert.match(src, /Year shown in design/);
  assert.match(src, /version \}/);
});
