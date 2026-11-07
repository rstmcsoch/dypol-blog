import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_EVENTS,
  christmasEvent,
  defaultEvents,
  eventHrefOk,
  eventStatus,
  newEventDraft,
  normalizeEvents,
  parseEvents,
  resolveActiveEvent,
} from "./events.ts";

const at = (iso: string) => Date.parse(iso);

test("christmas event is live across the season only", () => {
  // t202: Christmas ships switched off; once the owner enables it, it follows its window.
  assert.equal(eventStatus(christmasEvent(2026), at("2026-12-25T12:00:00Z")), "off");
  const event = { ...christmasEvent(2026), enabled: true };
  assert.equal(eventStatus(event, at("2026-11-07T12:00:00Z")), "upcoming");
  assert.equal(eventStatus(event, at("2026-12-01T00:00:00Z")), "live");
  assert.equal(eventStatus(event, at("2026-12-25T12:00:00Z")), "live");
  assert.equal(eventStatus(event, at("2027-01-06T23:00:00Z")), "live");
  assert.equal(eventStatus(event, at("2027-01-07T00:00:00Z")), "ended");
  assert.equal(eventStatus({ ...event, enabled: false }, at("2026-12-25T12:00:00Z")), "off");
});

test("default events follow the Christmas season being read", () => {
  const december = defaultEvents(new Date("2026-11-07T00:00:00Z"));
  assert.equal(december.events[0]?.id, "christmas");
  assert.equal(december.events[0]?.enabled, false);
  assert.equal(eventStatus(december.events[0]!, at("2026-12-25T00:00:00Z")), "off");
  assert.equal(eventStatus({ ...december.events[0]!, enabled: true }, at("2026-12-25T00:00:00Z")), "live");
  const january = defaultEvents(new Date("2027-01-03T00:00:00Z"));
  assert.equal(january.events[0]?.startsAt, "2026-12-01T00:00:00.000Z");
  assert.equal(eventStatus({ ...january.events[0]!, enabled: true }, at("2027-01-03T00:00:00Z")), "live");
});

test("resolveActiveEvent returns nothing outside a window and honours the preview override", () => {
  const event = { ...christmasEvent(2026), enabled: true };
  const config = { events: [event] };
  assert.equal(resolveActiveEvent(config, at("2026-11-07T00:00:00Z")), null);
  assert.equal(resolveActiveEvent(config, at("2026-12-25T00:00:00Z"))?.id, "christmas");
  const off = { events: [{ ...event, enabled: false }] };
  // t202: the override is honoured only for a signed-in admin (allowOverride).
  assert.equal(resolveActiveEvent(off, at("2026-11-07T00:00:00Z"), "christmas"), null);
  assert.equal(resolveActiveEvent(off, at("2026-11-07T00:00:00Z"), "christmas", false), null);
  assert.equal(resolveActiveEvent(off, at("2026-11-07T00:00:00Z"), "christmas", true)?.id, "christmas");
  assert.equal(resolveActiveEvent(config, at("2026-11-07T00:00:00Z"), "missing", true), null);
});

test("the most recently started live event wins", () => {
  const base = { ...christmasEvent(2026), enabled: true };
  const older = { ...base, id: "older", startsAt: "2026-12-01T00:00:00.000Z", endsAt: "2026-12-31T00:00:00.000Z" };
  const newer = { ...base, id: "newer", startsAt: "2026-12-20T00:00:00.000Z", endsAt: "2026-12-31T00:00:00.000Z" };
  assert.equal(resolveActiveEvent({ events: [older, newer] }, at("2026-12-25T00:00:00Z"))?.id, "newer");
});

test("stored data keeps valid events and drops broken ones", () => {
  const good = christmasEvent(2026);
  const config = normalizeEvents({
    events: [
      good,
      { ...good, id: "bad-colour", colors: { ...good.colors, primary: "red" } },
      { ...good, id: "bad-window", startsAt: "2026-12-10T00:00:00Z", endsAt: "2026-12-01T00:00:00Z" },
      { ...good, id: "christmas" },
    ],
  });
  assert.deepEqual(config.events.map((event) => event.id), ["christmas"]);
  assert.deepEqual(normalizeEvents(null).events, []);
});

test("saves reject an inverted window and unsafe links", () => {
  const event = christmasEvent(2026);
  assert.throws(() => parseEvents({ events: [{ ...event, endsAt: "2026-11-01T00:00:00.000Z" }] }));
  assert.throws(() => parseEvents({ events: [{ ...event, ctaLabel: "Read", ctaHref: "javascript:alert(1)" }] }));
  assert.equal(
    parseEvents({ events: [{ ...event, ctaLabel: "Read", ctaHref: "https://example.com/x" }] }).events[0]?.ctaHref,
    "https://example.com/x",
  );
  assert.equal(parseEvents({ events: [{ ...event, ctaLabel: "Read", ctaHref: "" }] }).events[0]?.ctaLabel, "");
});

test("hrefs allow site paths and https only", () => {
  assert.equal(eventHrefOk(""), true);
  assert.equal(eventHrefOk("/about"), true);
  assert.equal(eventHrefOk("//evil.example"), false);
  assert.equal(eventHrefOk("http://example.com"), false);
  assert.equal(eventHrefOk("https://example.com/x"), true);
});

test("new drafts start switched off and go live once enabled", () => {
  const now = new Date("2026-12-05T10:00:00Z");
  const draft = newEventDraft("christmas", now);
  assert.equal(draft.enabled, false);
  assert.equal(eventStatus(draft, now.getTime()), "off");
  assert.equal(eventStatus({ ...draft, enabled: true }, now.getTime()), "live");
  assert.ok(draft.id.startsWith("event-"));
  assert.ok(MAX_EVENTS >= 1);
});

test("dates are optional: empty start or end is open-ended", () => {
  const base = { ...christmasEvent(2026), enabled: true };
  const always = { ...base, startsAt: "", endsAt: "" };
  assert.equal(eventStatus(always, at("2020-01-01T00:00:00Z")), "live");
  assert.equal(eventStatus(always, at("2099-01-01T00:00:00Z")), "live");
  const untilEnd = { ...base, startsAt: "" };
  assert.equal(eventStatus(untilEnd, at("2020-01-01T00:00:00Z")), "live");
  assert.equal(eventStatus(untilEnd, at("2027-02-01T00:00:00Z")), "ended");
  const fromStart = { ...base, endsAt: "" };
  assert.equal(eventStatus(fromStart, at("2026-11-01T00:00:00Z")), "upcoming");
  assert.equal(eventStatus(fromStart, at("2030-01-01T00:00:00Z")), "live");
  assert.equal(parseEvents({ events: [always] }).events[0]?.startsAt, "");
  assert.throws(() => parseEvents({ events: [{ ...base, startsAt: "not a date" }] }));
  assert.equal(resolveActiveEvent({ events: [always] }, at("2026-11-07T00:00:00Z"))?.id, "christmas");
  assert.equal(eventStatus({ ...always, enabled: false }, at("2026-11-07T00:00:00Z")), "off");
});

test("an open-start event never beats one with a real start", () => {
  const base = { ...christmasEvent(2026), enabled: true };
  const always = { ...base, id: "always", startsAt: "", endsAt: "" };
  const dated = { ...base, id: "dated", startsAt: "2026-12-01T00:00:00.000Z", endsAt: "2026-12-31T00:00:00.000Z" };
  assert.equal(resolveActiveEvent({ events: [always, dated] }, at("2026-12-10T00:00:00Z"))?.id, "dated");
});
