// t210: date-only schedules in India time + editable display year.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  celebratedYear, christmasEvent, endOfDateIST, eventStatus, istDateOf, newYearEvent, normalizeEvents,
  parseDateOnly, parseEvents, startOfDateIST,
} from "./events.ts";
import { newYearMarkup, NY_SCENES } from "../components/site/event-decor-art.ts";

const at = (iso: string) => Date.parse(iso);

test("IST midnight edges map to exact UTC instants", () => {
  assert.equal(startOfDateIST("2026-12-31"), "2026-12-30T18:30:00.000Z");
  assert.equal(endOfDateIST("2027-01-02"), "2027-01-02T18:29:59.999Z");
  assert.equal(endOfDateIST("2026-12-31"), "2026-12-31T18:29:59.999Z");
  assert.equal(Date.parse(endOfDateIST("2027-01-02")!) + 1, Date.parse(startOfDateIST("2027-01-03")!));
  assert.equal(istDateOf("2026-12-30T18:30:00.000Z"), "2026-12-31");
  assert.equal(istDateOf("2026-12-30T18:29:59.999Z"), "2026-12-30");
  assert.equal(istDateOf(""), "");
});

test("calendar validation: leap years, bad days, bad formats", () => {
  assert.deepEqual(parseDateOnly("2028-02-29"), [2028, 2, 29]);
  assert.equal(parseDateOnly("2027-02-29"), null);
  assert.equal(parseDateOnly("2100-02-29"), null);
  assert.deepEqual(parseDateOnly("2000-02-29"), [2000, 2, 29]);
  for (const bad of ["2026-04-31", "2026-13-01", "2026-00-10", "2026-1-1", "2026-12-31T00:00", "", "abcd-ef-gh"]) assert.equal(parseDateOnly(bad), null, bad);
  assert.equal(startOfDateIST("2027-02-29"), null);
});

test("inclusive end: same-day and range schedules", () => {
  const day = { ...christmasEvent(2026), enabled: true, startsAt: startOfDateIST("2026-12-25")!, endsAt: endOfDateIST("2026-12-25")! };
  assert.equal(eventStatus(day, at("2026-12-24T18:29:59Z")), "upcoming");
  assert.equal(eventStatus(day, at("2026-12-24T18:30:00Z")), "live");
  assert.equal(eventStatus(day, at("2026-12-25T18:29:59Z")), "live");
  assert.equal(eventStatus(day, at("2026-12-25T18:30:00Z")), "ended");
  const ny = { ...newYearEvent(2026), enabled: true };
  assert.equal(eventStatus(ny, at("2027-01-02T18:00:00Z")), "live");
  assert.equal(eventStatus(ny, at("2027-01-02T18:30:00Z")), "ended");
});

test("server save enforces date-only, open-ended blanks allowed", () => {
  const base = { ...newYearEvent(2026) };
  assert.doesNotThrow(() => parseEvents({ events: [base] }));
  assert.doesNotThrow(() => parseEvents({ events: [{ ...base, startsAt: "", endsAt: "" }] }));
  assert.doesNotThrow(() => parseEvents({ events: [{ ...base, startsAt: "" }] }));
  assert.throws(() => parseEvents({ events: [{ ...base, startsAt: "2026-12-31T00:00:00.000Z" }] }));
  assert.throws(() => parseEvents({ events: [{ ...base, endsAt: "2027-01-02T23:59:00.000Z" }] }));
  assert.throws(() => parseEvents({ events: [{ ...base, endsAt: startOfDateIST("2027-01-03") }] }));
  assert.throws(() => parseEvents({ events: [{ ...base, startsAt: endOfDateIST("2027-01-03"), endsAt: startOfDateIST("2026-12-31") }] }));
});

test("legacy record unchanged: no-op on read and on save", () => {
  const legacy = { ...christmasEvent(2026), enabled: true, startsAt: "2026-12-31T00:00:00.000Z", endsAt: "2027-01-02T23:59:00.000Z" };
  const stored = { events: [legacy] };
  const read = normalizeEvents(JSON.parse(JSON.stringify(stored)));
  assert.equal(read.events[0]!.startsAt, legacy.startsAt);
  assert.equal(read.events[0]!.endsAt, legacy.endsAt);
  assert.equal("year" in read.events[0]!, false);
  const saved = parseEvents({ events: [{ ...legacy, title: "edited title" }] }, stored);
  assert.equal(saved.events[0]!.startsAt, legacy.startsAt);
  assert.equal(saved.events[0]!.endsAt, legacy.endsAt);
  // explicitly editing the date converts to the new semantics
  const edited = parseEvents({ events: [{ ...legacy, endsAt: endOfDateIST("2027-01-02") }] }, stored);
  assert.equal(edited.events[0]!.endsAt, "2027-01-02T18:29:59.999Z");
  // legacy shown as its IST date
  assert.equal(istDateOf(legacy.startsAt), "2026-12-31");
  assert.equal(istDateOf(legacy.endsAt), "2027-01-03");
  // a legacy value cannot be smuggled onto a different event id
  assert.throws(() => parseEvents({ events: [{ ...legacy, id: "other" }] }, stored));
});

test("display year: auto when blank, explicit wins, validated integer", () => {
  const ny = newYearEvent(2026);
  assert.equal(celebratedYear(ny), 2027);
  assert.equal(celebratedYear({ ...ny, year: null }), 2027);
  assert.equal(celebratedYear({ ...ny, year: 2028 }), 2028);
  assert.equal(celebratedYear({ ...ny, year: 2028 }, at("2030-06-01T00:00:00Z")), 2028);
  const saved = parseEvents({ events: [{ ...ny, year: 2028 }] });
  assert.equal(saved.events[0]!.year, 2028);
  assert.equal(normalizeEvents(JSON.parse(JSON.stringify(saved))).events[0]!.year, 2028);
  for (const bad of [1999, 2101, 2027.5, "2028", "<svg>"]) assert.throws(() => parseEvents({ events: [{ ...ny, year: bad }] }), String(bad));
  for (const mode of Object.keys(NY_SCENES) as (keyof typeof NY_SCENES)[]) {
    const out = newYearMarkup(mode, celebratedYear({ ...ny, year: 2028 }));
    assert.ok(out.includes("2028") && !out.includes("2027") && !out.includes("{{YEAR}}"), mode);
  }
});

test("admin UI: date inputs only, no time controls, year field", () => {
  const src = readFileSync(new URL("../routes/admin/events.tsx", import.meta.url), "utf8");
  assert.ok(!src.includes("datetime-local"));
  assert.ok(!/type="time"/.test(src));
  assert.equal((src.match(/type="date"/g) ?? []).length, 2);
  assert.ok(src.includes("Year shown in design"));
  assert.ok(!/new Date\(e\.target\.value\)/.test(src));
});
