import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_EVENTS,
  celebratedYear,
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
  assert.equal((decor.match(/aria-hidden="true"/g) ?? []).length, 6);
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
  assert.equal(ny.startsAt, "2026-12-31T00:00:00.000Z");
  assert.equal(ny.endsAt, "2027-01-02T23:59:00.000Z");
  const defaults = defaultEvents(new Date("2026-11-08T00:00:00Z"));
  assert.deepEqual(defaults.events.map((e) => [e.id, e.enabled]), [["christmas", false], ["newyear", false]]);
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
  const ny = css.slice(css.indexOf("/* ---- t208"));
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
