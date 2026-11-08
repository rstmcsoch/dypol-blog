import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_EVENTS,
  celebratedYear,
  EVENT_PRESETS,
  EVENT_THEMES,
  FESTIVAL_PRESET_THEMES,
  festivalEvent,
  migrateLegacyEvents,
  christmasEvent,
  defaultEvents,
  eventHrefOk,
  eventStatus,
  newEventDraft,
  newYearEvent,
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
  assert.equal(eventStatus(event, at("2026-11-30T18:30:00Z")), "live"); // t210: 1 Dec 00:00 IST
  assert.equal(eventStatus(event, at("2026-11-30T18:29:59Z")), "upcoming");
  assert.equal(eventStatus(event, at("2026-12-25T12:00:00Z")), "live");
  assert.equal(eventStatus(event, at("2027-01-06T18:29:59Z")), "live"); // 6 Jan 23:59:59 IST
  assert.equal(eventStatus(event, at("2027-01-06T18:30:00Z")), "ended"); // 7 Jan 00:00 IST
  assert.equal(eventStatus({ ...event, enabled: false }, at("2026-12-25T12:00:00Z")), "off");
});

test("default events follow the Christmas season being read", () => {
  const december = defaultEvents(new Date("2026-11-07T00:00:00Z"));
  assert.equal(december.events[0]?.id, "christmas");
  assert.equal(december.events[0]?.enabled, false);
  assert.equal(eventStatus(december.events[0]!, at("2026-12-25T00:00:00Z")), "off");
  assert.equal(eventStatus({ ...december.events[0]!, enabled: true }, at("2026-12-25T00:00:00Z")), "live");
  const january = defaultEvents(new Date("2027-01-03T00:00:00Z"));
  assert.equal(january.events[0]?.startsAt, "2026-11-30T18:30:00.000Z"); // t210: 1 Dec 00:00 IST
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

// ---- t202: static checks on the event stylesheet (decor never blocks clicks; reduced motion honoured) ----
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../styles-events.css", import.meta.url), "utf8");
const rule = (selector: string) => {
  const i = css.indexOf(`${selector} {`);
  assert.ok(i >= 0, `missing rule ${selector}`);
  return css.slice(i, css.indexOf("}", i));
};

test("particles are fixed, inert and contained", () => {
  const r = rule(".event-particles");
  assert.match(r, /position:\s*fixed/);
  assert.match(r, /pointer-events:\s*none/);
  assert.match(r, /contain:\s*strict/);
  assert.match(r, /overflow:\s*hidden/);
});

test("header and footer accents never take clicks", () => {
  assert.match(rule("[data-event] .site-header::after"), /pointer-events:\s*none/);
  assert.match(rule("[data-event] .site-footer::after"), /pointer-events:\s*none/);
});

test("reduced motion removes particles and stops the twinkle", () => {
  const i = css.indexOf("@media (prefers-reduced-motion: reduce)");
  assert.ok(i >= 0);
  const block = css.slice(i);
  assert.match(block, /\.event-particles\s*\{\s*display:\s*none/);
  assert.match(block, /\.site-footer::after\s*\{\s*animation:\s*none/);
});

test("every event rule is scoped, so nothing applies with no event", () => {
  const selectors = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*\s*\}/g, "").match(/[^{}]+(?=\{)/g) ?? [];
  for (const raw of selectors) {
    const sel = raw.trim();
    if (!sel || sel.startsWith("@media") || /^(from|to|\d+%)/.test(sel)) continue;
    for (const part of sel.split(",")) assert.match(part.trim(), /data-event|event-/, `unscoped selector: ${part.trim()}`);
  }
});

test("particle count is capped (18, 10 on phones) and the ribbon is not fixed", () => {
  assert.match(css, /nth-child\(n \+ 11\)\s*\{\s*display:\s*none/);
  assert.doesNotMatch(rule(".event-ribbon"), /position:\s*fixed/);
});

test("t204 Christmas footer: transform/opacity motion only, static under reduced motion, inert", () => {
  const decor = readFileSync(new URL("../components/site/event-decor.tsx", import.meta.url), "utf8");
  assert.equal((decor.match(/aria-hidden="true"/g) ?? []).length, 9);
  assert.doesNotMatch(decor, /<script|https?:\/\/(?!www\.w3\.org)/);
  for (const name of ["xmas-glow", "xmas-twinkle", "xmas-breathe", "xmas-swing", "xmas-fall"]) {
    const body = css.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
    assert.ok(body, name);
    const props = [...body.matchAll(/([a-z-]+):/g)].map((m) => m[1]);
    assert.ok(props.every((p) => p === "transform" || p === "opacity"), `${name}: ${props}`);
  }
  const reduced = css.slice(css.indexOf("prefers-reduced-motion", css.indexOf("@keyframes xmas-fall")));
  assert.match(reduced, /\.xs-village-glow \{\s*animation: none/);
  assert.match(reduced, /\.xs-flake \{ animation: none/);
  assert.match(css, /\.xmas-scene \{[\s\S]*?\}/);
  assert.match(css, /\.site-footer--xmas > \.xmas-scene \{[^}]*pointer-events: none/);
  assert.match(css, /\.event-hat \{[^}]*pointer-events: none/);
});

test("t204 footer: six production-style socials still render; only the standalone publisher link is dropped", async () => {
  const { visibleSocials, footerExtraLinks } = await import("./social-links.ts");
  const socials = [
    { platform: "x", url: "https://x.com/dypollabs", visible: true },
    { platform: "facebook", url: "https://www.facebook.com/dypollabs", visible: true },
    { platform: "instagram", url: "https://www.instagram.com/dypollabs", visible: true },
    { platform: "youtube", url: "https://www.youtube.com/dypollabs", visible: true },
    { platform: "linkedin", url: "", visible: false },
    { platform: "rss", url: "/feed.xml", visible: true },
    { platform: "email", url: "mailto:dypollabs@protonmail.com", visible: true },
  ] as Parameters<typeof visibleSocials>[0];
  assert.deepEqual(visibleSocials(socials).map((s) => s.url), [
    "https://x.com/dypollabs", "https://www.facebook.com/dypollabs", "https://www.instagram.com/dypollabs",
    "https://www.youtube.com/dypollabs", "/feed.xml", "mailto:dypollabs@protonmail.com",
  ]);
  const links = [
    { id: "a", label: "DYPOL LABS", href: "/about" },
    { id: "b", label: " dypol labs ", href: "/x" },
    { id: "c", label: "Advertise", href: "/advertise" },
    { id: "d", label: "DYPOL LABS Careers", href: "/careers" },
  ];
  assert.deepEqual(footerExtraLinks(links, "DYPOL LABS").map((l) => l.id), ["c", "d"]);
  assert.deepEqual(footerExtraLinks(links, "Acme").map((l) => l.id), ["a", "b", "c", "d"]);
  // Event CSS never hides or shrinks socials/brand/columns/copyright.
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (/footer-social|footer-brand|footer-columns|footer-sign|footer-link|footer-grid/.test(m[1])) {
      assert.doesNotMatch(m[2], /display:\s*none|visibility:\s*hidden|opacity:\s*0[;\s]|height:\s*0|overflow:\s*hidden/, m[1].trim());
    }
  }
});

test("t205 scene variants: hero motifs composed inside every frame, no collisions, caps only trim sky", async () => {
  const { SCENE_LAYOUT, SCENE_MODES } = await import("../components/site/event-decor-art.ts");
  const cap = (mode: string) => Number(css.match(new RegExp(`\\.xmas-scene__v--${mode} \\{[^}]*max-height: (\\d+)px`))?.[1]);
  // [min, max] rendered width per mode (wide is limited by max-width: 1920px).
  const ranges: Record<string, [number, number]> = { compact: [300, 599], medium: [600, 1099], wide: [1100, 1920] };
  assert.match(css, /\.xmas-scene__v--wide \{[^}]*max-width: 1920px/);
  for (const mode of SCENE_MODES) {
    const { w, h, boxes } = SCENE_LAYOUT[mode];
    for (const key of ["moon", "village", "tree", "gifts", "lamp"] as const) {
      const [x1, y1, x2, y2] = boxes[key];
      assert.ok(x1 >= 0 && y1 >= 0 && x2 <= w && y2 <= h, `${mode}.${key} inside ${w}x${h}: ${boxes[key]}`);
    }
    const ground = ["tree", "gifts", "village", "lamp"] as const;
    for (let i = 0; i < ground.length; i++) for (let j = i + 1; j < ground.length; j++) {
      const a = boxes[ground[i]], b = boxes[ground[j]];
      assert.ok(a[2] <= b[0] || b[2] <= a[0], `${mode}: ${ground[i]} and ${ground[j]} overlap horizontally`);
    }
    // Phone keeps the decorated tree as a real hero (>= 18% of the frame width), not a crumb.
    if (mode === "compact") assert.ok((boxes.tree[2] - boxes.tree[0]) / w >= 0.18);
    const max = cap(mode);
    assert.ok(max > 0, `${mode} cap`);
    for (const width of ranges[mode]) {
      const natural = (width * h) / w;
      const trimmed = natural > max ? h - max / (width / w) : 0; // xMidYMax slice trims the top only
      const topMost = Math.min(...Object.values(boxes).map((b) => b[1]));
      assert.ok(trimmed < topMost, `${mode}@${width}px trims ${trimmed.toFixed(1)} >= motif top ${topMost}`);
    }
  }
});

test("t205 static markup: three scene variants with unique ids, no dangling refs, inert", async () => {
  const { SCENES, SCENE_MODES, GARLAND } = await import("../components/site/event-decor-art.ts");
  const all = SCENE_MODES.map((m) => SCENES[m]).join("");
  const ids = [...all.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length >= 9);
  assert.equal(new Set(ids).size, ids.length, "gradient ids unique across variants");
  for (const m of all.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.includes(m[1]), `dangling ${m[1]}`);
  for (const mode of SCENE_MODES) for (const motif of ["xs-bigtree", "xs-gifts", "xs-village", "xs-lamp", "xs-moon"]) assert.ok(SCENES[mode].includes(`class="${motif}"`), `${mode} ${motif}`);
  assert.doesNotMatch(all + GARLAND, /<a |<button|tabindex|<script|href=/);
});

test("t206 open menu: original design untouched, only the existing snowfall is lifted above it", () => {
  const header = readFileSync(new URL("../components/site/header.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(header, /xmas|Christmas(?!.*SantaHat)|MenuDecor/i);
  // No event rule styles the menu, its buttons, links, chips, search or background.
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    assert.doesNotMatch(m[1], /site-nav|nav-link|nav-chip|menu-btn|search-form|\.btn\b|theme-toggle|search-btn/, m[1].trim());
  }
  assert.doesNotMatch(css, /xmas-menu/);
  // The single menu-related rule: snow above the sticky header's stacking context, still inert.
  assert.match(css, /html\.nav-open \[data-event\] \.event-particles \{\s*z-index: 31;\s*\}/);
  assert.match(css, /\.event-particles \{[^}]*pointer-events: none/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.event-particles \{\s*display: none/);
});

// ---- t208: New Year ----

test("t208 New Year preset: off by default, its own id/theme/dates, valid against the stored schema", () => {
  const ny = newYearEvent(2026);
  assert.equal(ny.id, "newyear");
  assert.equal(ny.theme, "newyear");
  assert.equal(ny.enabled, false);
  assert.equal(ny.effect, "sparkle");
  assert.equal(ny.startsAt, "2026-12-30T18:30:00.000Z"); // t210: 31 Dec 00:00 IST
  assert.equal(ny.endsAt, "2027-01-02T18:29:59.999Z"); // 2 Jan 23:59:59.999 IST (not 3 Jan)
  const defaults = defaultEvents(new Date("2026-11-08T00:00:00Z"));
  assert.deepEqual(defaults.events.map((e) => [e.id, e.enabled]), [["christmas", false]]); // t211: no seeded New Year card
  // Stored configs (e.g. production's single Christmas event) round-trip untouched; the preset is never injected.
  const stored = { events: [{ ...defaults.events[0], enabled: true, startsAt: "2026-11-01T00:00:00.000Z", endsAt: "2026-12-03T23:59:00.000Z" }] };
  assert.deepEqual(normalizeEvents(stored), stored);
  assert.deepEqual(normalizeEvents({ events: [...stored.events, ny] }).events.map((e) => e.id), ["christmas", "newyear"]);
  // Off = never live by itself; only an admin preview override shows it.
  const config = { events: [ny] };
  assert.equal(resolveActiveEvent(config, Date.parse("2027-01-01T00:00:00Z")), null);
  assert.equal(resolveActiveEvent(config, Date.parse("2027-01-01T00:00:00Z"), "newyear", false), null);
  assert.equal(resolveActiveEvent(config, Date.parse("2027-01-01T00:00:00Z"), "newyear", true)?.id, "newyear");
});

test("t208 celebrated year: held inside the event window, month-based so midnight time zones never flip it", () => {
  const ny = newYearEvent(2026);
  assert.equal(celebratedYear(ny, Date.parse("2026-11-08T03:00:00Z")), 2027); // preview before the window
  assert.equal(celebratedYear(ny, Date.parse("2026-12-31T18:29:59Z")), 2027); // 23:59 IST on 31 Dec
  assert.equal(celebratedYear(ny, Date.parse("2026-12-31T23:59:59Z")), 2027);
  assert.equal(celebratedYear(ny, Date.parse("2027-01-01T00:00:01Z")), 2027);
  assert.equal(celebratedYear(ny, Date.parse("2027-03-01T00:00:00Z")), 2027); // after the window: clamped to its end
  const custom = { startsAt: "", endsAt: "" };
  assert.equal(celebratedYear(custom, Date.parse("2027-01-15T00:00:00Z")), 2027);
  assert.equal(celebratedYear(custom, Date.parse("2027-10-02T00:00:00Z")), 2028);
  assert.equal(celebratedYear(null, Date.parse("2030-12-31T12:00:00Z")), 2031);
});

test("t208 New Year scenes: composed per size, no collisions, caps only trim sky, year injected safely", async () => {
  const { NY_LAYOUT, NY_SCENES, NY_FRIEZE, SCENE_MODES, newYearMarkup, SCENES, GARLAND } = await import("../components/site/event-decor-art.ts");
  const cap = (mode: string) => Number(css.match(new RegExp(`\\.ny-scene__v--${mode} \\{[^}]*max-height: (\\d+)px`))?.[1]);
  const ranges: Record<string, [number, number]> = { compact: [300, 599], medium: [600, 1099], wide: [1100, 1920] };
  assert.match(css, /\.ny-scene__v--wide \{[^}]*max-width: 1920px/);
  for (const mode of SCENE_MODES) {
    const { w, h, boxes } = NY_LAYOUT[mode];
    for (const key of ["year", "clock", "glasses", "burst0", "burst1"]) assert.ok(boxes[key], `${mode} has ${key}`);
    const keys = Object.keys(boxes);
    for (const key of keys) {
      const [x1, y1, x2, y2] = boxes[key];
      assert.ok(x1 >= 0 && y1 >= 0 && x2 <= w && y2 <= h, `${mode}.${key} inside: ${boxes[key]}`);
    }
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const a = boxes[keys[i]], b = boxes[keys[j]];
      const apart = a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1];
      assert.ok(apart, `${mode}: ${keys[i]} overlaps ${keys[j]}`);
    }
    // The year reads as a headline on phones (>= 30% of the frame width).
    if (mode === "compact") assert.ok((boxes.year[2] - boxes.year[0]) / w >= 0.3);
    const topMost = Math.min(...Object.values(boxes).map((b) => b[1]));
    for (const width of ranges[mode]) {
      const natural = (width * h) / w;
      const trimmed = natural > cap(mode) ? h - cap(mode) / (width / w) : 0;
      assert.ok(trimmed < topMost, `${mode}@${width}px trims ${trimmed.toFixed(1)}`);
    }
    const markup = newYearMarkup(mode, 2027);
    assert.ok(markup.includes(">2027</text>") && !markup.includes("{{YEAR}}"));
    assert.ok(!newYearMarkup(mode, Number.NaN).includes("NaN"));
  }
  const all = SCENE_MODES.map((m) => NY_SCENES[m]).join("") + NY_FRIEZE;
  const ids = [...all.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  const xmasIds = [...SCENE_MODES.map((m) => SCENES[m]).join("").matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set([...ids, ...xmasIds]).size, ids.length + xmasIds.length, "ids unique across themes");
  for (const m of all.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.includes(m[1]), `dangling ${m[1]}`);
  // No Christmas motif leaks into New Year art, and the reverse.
  assert.doesNotMatch(all, /class="(xs-|xg-|xmas)|bigtree|village|garland|santa|hat|snow/i);
  assert.doesNotMatch(SCENE_MODES.map((m) => SCENES[m]).join("") + GARLAND, /class="ny|nyf-/);
  assert.doesNotMatch(all, /<a |<button|tabindex|<script|href=/);
});

test("t208 New Year wiring: theme-gated header/footer, inert, reduced motion static, no menu restyle", () => {
  const header = readFileSync(new URL("../components/site/header.tsx", import.meta.url), "utf8");
  assert.match(header, /event\?\.theme === "christmas" \? <SantaHat \/> : null/);
  assert.match(header, /event\?\.theme === "newyear" \? <LogoSparkle \/> : null/);
  const footer = readFileSync(new URL("../components/site/footer.tsx", import.meta.url), "utf8");
  assert.match(footer, /newYear \? <NewYearFrieze \/> : null/);
  assert.match(footer, /newYear && event \? <NewYearFooterScene year=\{celebratedYear\(event\)\} \/> : null/);
  const decor = readFileSync(new URL("../components/site/event-decor.tsx", import.meta.url), "utf8");
  for (const cls of ["event-sparkle", "ny-frieze", "ny-scene"]) assert.match(decor, new RegExp(`className="${cls}"[^>]*aria-hidden="true"|className=\\{?\`?${cls}`));
  const ny = css.slice(css.indexOf("/* ---- t208"), css.indexOf("/* ---- t209"));
  for (const m of ny.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const sel = m[1].trim();
    if (/^(@|from|to|\d+%)/.test(sel)) continue;
    for (const part of sel.split(",")) assert.match(part.trim(), /^\[data-event="newyear"\]/, part.trim());
    assert.doesNotMatch(sel, /site-nav|nav-link|nav-chip|menu-btn|search-form|\.btn\b|theme-toggle/);
  }
  for (const name of ["ny-bloom", "ny-twinkle", "ny-glow", "ny-shimmer", "ny-rise", "ny-sway"]) {
    const body = css.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
    assert.ok(body, name);
    const props = [...body.matchAll(/([a-z-]+):/g)].map((x) => x[1]);
    assert.ok(props.every((p) => p === "transform" || p === "opacity"), `${name}: ${props}`);
    const durations = [...css.matchAll(new RegExp(`animation: ${name} ([\\d.]+)s`, "g"))].map((x) => Number(x[1]));
    assert.ok(durations.length && durations.every((d) => d >= 4), `${name} is slow (no flashing): ${durations}`);
  }
  const reduced = ny.slice(ny.indexOf("prefers-reduced-motion"));
  assert.match(reduced, /\.ny-burst \.ny-ray[\s\S]*?\{\s*animation: none/);
  assert.match(reduced, /\.ny-bubble \{ animation: none/);
  assert.match(css, /\.site-footer--newyear > \.ny-scene \{[^}]*pointer-events: none/);
  assert.match(css, /\[data-event="newyear"\] \.event-sparkle \{[^}]*pointer-events: none/);
});

test("t208 pre-release: New Year footer palette is theme-independent and high contrast; every NY animation stops under reduced motion; Add New Year saves", () => {
  const ny = css.slice(css.indexOf("/* ---- t208"), css.indexOf("/* ---- t209"));
  assert.doesNotMatch(ny, /data-theme|prefers-color-scheme|\.dark\b/);
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const v = (name: string) => ny.match(new RegExp(`${name}: (#[0-9a-f]{6})`))?.[1] as string;
  for (const bg of [v("--ft-top"), v("--ft-mid"), v("--ft-bottom")]) {
    assert.ok(ratio(v("--ft-fg"), bg) >= 7, `ivory on ${bg}`);
    assert.ok(ratio(v("--ft-muted"), bg) >= 4.5, `gold titles on ${bg}`);
  }
  const animated = [...ny.matchAll(/([^{}]+)\{[^}]*animation: ny-/g)].flatMap((m) => m[1].split(",").map((s) => s.trim().replace(/^\[data-event="newyear"\] /, "")));
  const reduced = ny.slice(ny.indexOf("@media (prefers-reduced-motion: reduce)"));
  for (const sel of new Set(animated)) {
    const base = sel.replace(/\.ny-b\d .*|\.nyf-d\d|\.ny-s\d|\.nyf-g\d|\.ny-w\d|\.ny-r\d|\.ny-bb\d/, "").trim();
    if (!base) continue;
    assert.ok(reduced.includes(base), `reduced motion covers ${sel}`);
  }
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.event-particles \{\s*display: none/);
  const saved = parseEvents({ events: [christmasEvent(2026), newYearEvent(2026)] });
  assert.deepEqual(saved.events.map((e) => [e.id, e.theme, e.enabled]), [["christmas", "christmas", false], ["newyear", "newyear", false]]);
  const admin = readFileSync(new URL("../routes/admin/events.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(admin, /addNewYear|Add New Year/); // t211: picked from the Design dropdown instead
});

// ---- t209: Diwali / Holi / Eid; Valentine's Day removed ----
test("t209 themes: Valentine's removed everywhere; festivals are presets, OFF, with no invented dates", () => {
  assert.ok(!(EVENT_THEMES as readonly string[]).includes("valentines"));
  assert.ok(!EVENT_PRESETS.some((p) => /valentine/i.test(`${p.value} ${p.label} ${p.message}`)));
  for (const theme of ["diwali", "holi", "eid"] as const) assert.ok((EVENT_THEMES as readonly string[]).includes(theme));
  assert.deepEqual([...FESTIVAL_PRESET_THEMES], ["diwali", "holi", "eid"]);
  for (const theme of FESTIVAL_PRESET_THEMES) {
    const e = festivalEvent(theme);
    assert.equal(e.id, theme);
    assert.equal(e.enabled, false);
    assert.equal(e.startsAt, "");
    assert.equal(e.endsAt, "");
    assert.equal(eventStatus(e, Date.now()), "off");
    assert.equal(resolveActiveEvent({ events: [e] }, Date.now()), null);
    assert.equal(resolveActiveEvent({ events: [e] }, Date.now(), theme, false), null);
    assert.equal(resolveActiveEvent({ events: [e] }, Date.now(), theme, true)?.theme, theme);
  }
  // Eid is generic: no al-Fitr / al-Adha assumption in the preset.
  assert.doesNotMatch(JSON.stringify(EVENT_PRESETS.find((p) => p.value === "eid")), /fitr|adha|ramadan/i);
  // No alcohol in the festival presets.
  assert.doesNotMatch(JSON.stringify(EVENT_PRESETS.filter((p) => ["diwali", "holi", "eid"].includes(p.value))), /champagne|wine|toast|cheers/i);
  // Defaults are unchanged (festivals are added by the owner, never auto-written).
  assert.deepEqual(defaultEvents(new Date("2026-11-08T00:00:00Z")).events.map((e) => e.id), ["christmas"]);
  // Admin save (strict) of all presets works; Valentine's theme is rejected for new saves.
  const saved = parseEvents({ events: [christmasEvent(2026), newYearEvent(2026), ...FESTIVAL_PRESET_THEMES.map(festivalEvent)] });
  assert.deepEqual(saved.events.map((e) => e.id), ["christmas", "newyear", "diwali", "holi", "eid"]);
  assert.throws(() => parseEvents({ events: [{ ...christmasEvent(2026), id: "x", theme: "valentines" }] }));
  const admin = readFileSync(new URL("../routes/admin/events.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(admin, /addFestival|FESTIVAL_PRESET_THEMES/); // t211: no per-theme add buttons
  assert.match(admin, /set this year's dates before switching on/);
});

test("t209 legacy stored data: the Valentine's event is removed, other legacy-theme events kept as Custom, production shape untouched", () => {
  const xmas = { ...christmasEvent(2026), enabled: true, startsAt: "2026-11-01T00:00:00.000Z", endsAt: "2026-12-03T23:59:00.000Z" };
  const valentine = { ...christmasEvent(2026), id: "valentines", name: "Valentine's Day", theme: "valentines", enabled: true };
  const valentineById = { ...christmasEvent(2026), id: "event-valentine-2027", name: "Love week", theme: "valentines" };
  const repurposed = { ...christmasEvent(2026), id: "spring-sale", name: "Spring sale", theme: "valentines", message: "Keep me" };
  const out = normalizeEvents({ events: [xmas, valentine, valentineById, repurposed] });
  assert.deepEqual(out.events.map((e) => [e.id, e.theme]), [["christmas", "christmas"], ["spring-sale", "custom"]]);
  assert.equal(out.events[1].message, "Keep me");
  assert.deepEqual(out.events[0], xmas);
  // Production today (Christmas only) is a no-op.
  assert.deepEqual(migrateLegacyEvents({ events: [xmas] }), { events: [xmas] });
  assert.deepEqual(normalizeEvents({ events: [xmas] }), { events: [xmas] });
  assert.equal(migrateLegacyEvents(null), null);
});

test("t209 festival art: composed per size, inside the frame, no collisions, caps only trim sky, unique ids, no bleed", async () => {
  const art = await import("../components/site/event-decor-art.ts");
  const { FESTIVAL_ART, FESTIVAL_THEMES, SCENE_MODES, SCENES, NY_SCENES, GARLAND, NY_FRIEZE } = art;
  const ranges: Record<string, [number, number]> = { compact: [300, 599], medium: [600, 1099], wide: [1100, 1920] };
  const capOf = (mode: string) => Number(css.match(new RegExp(`\\[data-event="diwali"\\] \\.fest-scene__v--${mode} \\{[^}]*max-height: (\\d+)px`))?.[1]);
  const required: Record<string, string[]> = { diwali: ["text", "rangoli", "diya0", "diya3", "lantern0", "lantern1"], holi: ["text", "cloud0", "cloud1", "thali0", "thali1"], eid: ["text", "moon", "lamp0", "arcade"], halloween: ["text", "moon", "pumpkin0", "pumpkin1", "bat0", "house0"] };
  const allIds: string[] = [];
  for (const theme of FESTIVAL_THEMES) {
    for (const mode of SCENE_MODES) {
      const { w, h, boxes } = FESTIVAL_ART[theme].layout[mode];
      for (const key of required[theme]) assert.ok(boxes[key], `${theme}.${mode} has ${key}`);
      const keys = Object.keys(boxes);
      for (const key of keys) {
        const [x1, y1, x2, y2] = boxes[key];
        assert.ok(x1 >= 0 && y1 >= 0 && x2 <= w && y2 <= h, `${theme}.${mode}.${key} inside ${w}x${h}: ${boxes[key]}`);
      }
      for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
        const a = boxes[keys[i]], b = boxes[keys[j]];
        assert.ok(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1], `${theme}.${mode}: ${keys[i]} overlaps ${keys[j]}`);
      }
      const topMost = Math.min(...Object.values(boxes).filter((b) => b[1] > 0).map((b) => b[1]), h);
      for (const width of ranges[mode]) {
        const natural = (width * h) / w;
        const trimmed = natural > capOf(mode) ? h - capOf(mode) / (width / w) : 0;
        assert.ok(trimmed <= 0.5 || trimmed < topMost, `${theme}.${mode}@${width} trims ${trimmed.toFixed(1)}`);
      }
      const markup = FESTIVAL_ART[theme].scenes[mode];
      assert.doesNotMatch(markup, /<a |<button|tabindex|<script|href=|\{\{/);
      allIds.push(...[...markup.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
      for (const m of markup.matchAll(/url\(#([^)]+)\)/g)) assert.ok(markup.includes(` id="${m[1]}"`), `${theme}.${mode} dangling ${m[1]}`);
    }
    allIds.push(...[...FESTIVAL_ART[theme].frieze.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
    const all = SCENE_MODES.map((m) => FESTIVAL_ART[theme].scenes[m]).join("") + FESTIVAL_ART[theme].frieze;
    // No bleed between themes: own prefix only, no Christmas/New Year motifs, no alcohol imagery.
    const own = { diwali: "dw-", holi: "hl", eid: "ed-", halloween: "hw-" }[theme] as string;
    for (const cls of all.matchAll(/class="([^"]+)"/g)) for (const c of cls[1].split(" ")) assert.ok(c.startsWith(own), `${theme} uses foreign class ${c}`);
    assert.doesNotMatch(all, /ny-|xs-|xg-|xmas|glass|bubbly|champagne|santa|snow/i);
  }
  for (const m of SCENE_MODES) allIds.push(...[...(SCENES[m] + NY_SCENES[m]).matchAll(/ id="([^"]+)"/g)].map((x) => x[1]));
  allIds.push(...[...(GARLAND + NY_FRIEZE).matchAll(/ id="([^"]+)"/g)].map((x) => x[1]));
  assert.equal(new Set(allIds).size, allIds.length, "ids unique across every theme");
});

test("t209 festival wiring + CSS: theme-gated, inert, palettes legible, slow motion, reduced motion static, menu untouched", () => {
  const header = readFileSync(new URL("../components/site/header.tsx", import.meta.url), "utf8");
  assert.match(header, /FESTIVAL_THEMES\.includes\(event\?\.theme as FestivalTheme\) \? <FestivalOrnament/);
  const footer = readFileSync(new URL("../components/site/footer.tsx", import.meta.url), "utf8");
  assert.match(footer, /festival \? <FestivalFrieze theme=\{festival\} \/> : null/);
  assert.match(footer, /festival \? <FestivalFooterScene theme=\{festival\} \/> : null/);
  const block = css.slice(css.indexOf("/* ---- t209"));
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  for (const theme of ["diwali", "holi", "eid", "halloween"]) {
    const vars = block.match(new RegExp(`\\[data-event="${theme}"\\] \\.site-footer--${theme} \\{([^}]*)\\}`))?.[1] ?? "";
    const v = (n: string) => vars.match(new RegExp(`${n}: (#[0-9a-f]{6})`))?.[1] as string;
    for (const bg of [v("--ft-top"), v("--ft-mid"), v("--ft-bottom")]) {
      assert.ok(ratio(v("--ft-fg"), bg) >= 7, `${theme} text on ${bg}`);
      assert.ok(ratio(v("--ft-muted"), bg) >= 4.5, `${theme} titles on ${bg}`);
    }
    assert.match(block, new RegExp(`\\.site-footer--${theme} > \\.fest-scene \\{[^}]*pointer-events: none`));
    assert.match(block, new RegExp(`\\[data-event="${theme}"\\] \\.event-ornament \\{[^}]*pointer-events: none`));
  }
  for (const m of block.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const sel = m[1].trim();
    if (/^(@|from|to|\d+%)/.test(sel)) continue;
    for (const part of sel.split(",")) assert.match(part.trim(), /^\[data-event="(diwali|holi|eid|halloween)"\]/, part.trim());
    assert.doesNotMatch(sel, /site-nav|nav-link|nav-chip|menu-btn|search-form|\.btn\b|theme-toggle|data-theme/);
  }
  for (const name of ["fest-flicker", "fest-glow", "fest-twinkle", "fest-sway", "fest-breathe", "fest-breathe-o", "fest-drift", "fest-float"]) {
    const body = css.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
    assert.ok(body, name);
    assert.ok([...body.matchAll(/([a-z-]+):/g)].every((x) => x[1] === "transform" || x[1] === "opacity"), name);
    const d = [...css.matchAll(new RegExp(`animation: ${name} ([\\d.]+)s`, "g"))].map((x) => Number(x[1]));
    assert.ok(d.length && d.every((x) => x >= 3.6), `${name} slow: ${d}`);
  }
  const reduced = block.slice(block.indexOf("@media (prefers-reduced-motion: reduce)"));
  const animated = [...block.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{[^}]*animation: fest-/g)].flatMap((m) => m[1].split(",").map((x) => x.trim()));
  for (const sel of new Set(animated)) {
    const base = sel.replace(/ \.(dw-d\d|dw-w\d|dw-u\d|dw-s\d|dw-t\d|ed-t\d|hl-c\d|hl-rb\d|hl-ds\d|hl-fl\d|hl-fw\d|ed-h\d|ed-a\d)\b.*$/, "");
    if (/ \.(dw-d|dw-w|dw-u|dw-s|dw-t|ed-t|hl-c|hl-rb|hl-ds|hl-fl|hl-fw|ed-h|ed-a)\d/.test(sel)) continue;
    assert.ok(reduced.includes(base), `reduced motion covers ${sel}`);
  }
});

test("t211: one generic Add event + Design dropdown with every theme; no seeded New Year row", async () => {
  const { readFileSync } = await import("node:fs");
  const admin = readFileSync(new URL("../routes/admin/events.tsx", import.meta.url), "utf8");
  assert.equal((admin.match(/onClick=\{add[A-Za-z]*\}/g) ?? []).join(","), "onClick={addEvent}");
  assert.match(admin, /EVENT_PRESETS\.map\(\(preset\)/);
  const themes = EVENT_PRESETS.map((p) => p.value);
  for (const t of ["christmas", "newyear", "diwali", "holi", "eid"]) assert.ok(themes.includes(t as never), t);
  assert.ok(!themes.includes("valentines" as never));
  assert.deepEqual(defaultEvents(new Date("2026-12-31T00:00:00Z")).events.map((e) => e.id), ["christmas"]);
  // Switching theme keeps the owner's name, year, dates and enabled state (only design defaults change).
  const ev = { ...christmasEvent(2026), name: "New Year", year: 2028, enabled: true };
  const preset = EVENT_PRESETS.find((p) => p.value === "newyear")!;
  const switched = { ...ev, theme: "newyear" as const, effect: preset.effect, colors: { ...preset.colors } };
  const out = parseEvents({ events: [switched] }).events[0]!;
  assert.equal(out.name, "New Year"); assert.equal(out.year, 2028); assert.equal(out.startsAt, ev.startsAt); assert.equal(out.enabled, true);
  // Stored multi-event configs (incl. any newyear id) round-trip untouched — nothing is filtered on read.
  const stored = { events: [{ ...ev, theme: "halloween" as never }, { ...newYearEvent(2026), theme: "halloween" as never }] };
  const read = normalizeEvents(JSON.parse(JSON.stringify(stored)));
  assert.deepEqual(read.events.map((e) => e.id), ["christmas", "newyear"]);
});

test("t212 Halloween: generic dropdown theme gets festival art; motion slow + static under reduced motion; stored card unchanged", async () => {
  const art = await import("../components/site/event-decor-art.ts");
  assert.ok(art.FESTIVAL_THEMES.includes("halloween"));
  for (const m of art.SCENE_MODES) assert.match(art.FESTIVAL_ART.halloween.scenes[m], /HAPPY HALLOWEEN/);
  assert.doesNotMatch(JSON.stringify(art.FESTIVAL_ART.halloween), /blood|skull|gore|<script|href=/i);
  const block = css.slice(css.indexOf("/* ---- t212"));
  assert.ok(block.length > 500);
  for (const name of ["hw-glide", "hw-flap"]) {
    const body = css.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
    assert.ok([...body.matchAll(/([a-z-]+):/g)].every((x) => x[1] === "transform" || x[1] === "opacity"), name);
    const d = [...css.matchAll(new RegExp(`animation: ${name} ([\\d.]+)s`, "g"))].map((x) => Number(x[1]));
    assert.ok(d.length && d.every((x) => x >= 3.6), name);
  }
  const reduced = block.slice(block.indexOf("@media (prefers-reduced-motion: reduce)"));
  const animated = [...block.slice(0, block.indexOf("@media (prefers-reduced-motion")).replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{[^}]*animation: (?!none)/g)].flatMap((m) => m[1].split(",").map((x) => x.trim().split(" .")[1]?.split(" ")[0]));
  for (const cls of new Set(animated.filter(Boolean))) {
    const base = cls.replace(/^(hw-[a-z]+?)\d$/, "$1");
    if (/^hw-(b|p|w|t|h)\d$/.test(cls)) continue; // delay-only modifiers
    assert.ok(reduced.includes(`.${base}`), `reduced motion stops ${cls}`);
  }
  assert.match(block, /\.site-footer--halloween > \.fest-scene \{[^}]*pointer-events: none/);
  // The live "Christmas" card with the Halloween design keeps its name/message/dates exactly.
  const live = { ...christmasEvent(2026), enabled: true, theme: "halloween" as const, message: "Happy Halloween from DYPOL BLOG — read something eerie tonight.", startsAt: "2026-11-01T00:00:00.000Z", endsAt: "2026-12-03T23:59:00.000Z" };
  assert.deepEqual(normalizeEvents(JSON.parse(JSON.stringify({ events: [live] }))), { events: [live] });
});
