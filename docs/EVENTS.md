# Seasonal events (Admin → Events) — design and implementation plan (t202)

## Audit of main `4e0afa1` (reused, not duplicated)
Main already had a reusable events system: `src/lib/events.ts` (pure model, presets,
zod schema, status/resolve), `src/content/events.server.ts` (own `site_settings` row
`site_events`, `cachedRead`), admin tab `src/routes/admin/events.tsx`, public layer
`src/components/site/event-layer.tsx` + `src/styles-events.css`, wired through the root
loader (`getShell`). It is ported as-is (commit "Port seasonal events…") onto the live
Sharing release `fb5d18b`, **without** the Webpushr commits, `public/webpushr-sw.js`,
`_headers` changes or the 5 PNG screenshots.

Defects found and fixed in the follow-up commit:
1. Christmas shipped **enabled** (Dec 1 → Jan 6) — it would have switched itself on in
   production. Now every default and every new event is **off**; the owner turns it on.
2. `styles-events.css` was a render-blocking stylesheet on **every** page even with no
   event. Now the `<link>` is emitted only while an event is shown.
3. `/?event=<id>` previewed any event (including switched-off drafts) for **anyone**, and
   the response was publicly cacheable. Now the override is honoured only with a valid
   admin desk session, and any `?event=` response is `no-store` + `noindex`.
4. Dates were mandatory. Now start/end are each optional (empty = open-ended), so
   "on until I switch it off" works; when both are set, end must be after start.
5. Dismissing the ribbon was applied after hydration (flash + layout shift on every page
   for visitors who dismissed it). Now a tiny inline script hides it before first paint.
6. The layer also rendered on `/preview/*` (admin article preview). Admin, preview, API,
   MCP and auth paths never show it.

## Behaviour
- Active event = enabled and inside its (optional) window, resolved per request with
  `Date.now()`; config is cached via `cachedRead` and every save writes `site_settings`,
  which bumps `content_version`, so all isolates pick it up immediately. Scheduled start/
  end need no cron: the next request after the boundary flips it. Public HTML keeps the
  site's existing `max-age=60` browser/shared cache (same as every other setting).
- Decorations: ribbon above the header (optional message + CTA + dismiss), a thin festive
  rule under the sticky header, twinkling lights above the footer, optional particles
  (snow/confetti/sparkle) — 18 CSS-only pieces, 10 on phones, `position: fixed`,
  `pointer-events: none`, `aria-hidden`, `contain: strict`, hidden under
  `prefers-reduced-motion` (twinkle stops). No audio, no popup, no JS loop, no images.
- Base site with no event: byte-identical markup apart from nothing (no attributes, no
  stylesheet, no layer).

## Tests
`src/lib/events.test.ts`: defaults off, open-ended windows, end>start only when both,
admin-only override, resolution order, href safety. Plus root SSR comparison against the
live release (event off ⇒ identical heads/share links), typecheck, build, full suites
with the pre-existing failures listed explicitly.

## Release / merge strategy
Branch `events-christmas` = `fb5d18b` (live) + port + fixes. Deploy (after browser check)
with the same one-off Workers build of this exact commit used for Sharing; the trigger and
`main` stay untouched. `main` must not be built until it contains this branch: reconcile
by merging `events-christmas` into a branch from `main`, dropping/keeping Webpushr as the
owner decides, then PR into `main`.

## t203 — Christmas hat + footer scene (plan)
- Hat: inline SVG (`event-decor.tsx` `SantaHat`) inside `.wordmark`, absolutely positioned above the first letter, tilted, `pointer-events:none`, aria-hidden. Nothing covers the lettering or BLOG badge.
- Footer: `ChristmasFooterScene` is its own row after the footer grid (in normal flow, so it can never overlap text/links): four sparse evergreens + one bell on a hairline, right-aligned (centred on mobile).
- Motion: trees fade/rise in once (staggered), then a ~1° sway; bell ±5° swing. Transform/opacity only; none under reduced motion.
- Only rendered when the shown event theme is `christmas`; `useEvent()` now returns null on `/preview`, so the header, footer and shell agree.

## t204 — Christmas night footer (replaces the t203 tiny trees/bell)
Art direction: "Christmas Eve over a quiet village". The footer turns into a night sky (midnight navy, candle-gold accents, holly-red link underlines, snow white) only while the Christmas theme is on. Reasoning: the silver footer can't carry warm lights. A night palette makes the glowing windows, bulbs and moon read, and keeps cream text at high contrast.
- Top band (own row): an evergreen garland in swags with coloured bulbs and seven hanging baubles. Bulbs glow, baubles swing ±4°.
- Content: the real brand, description, socials, Explore/Company/Legal and copyright are unchanged. They get re-tinted (gold column titles, a star after the wordmark, gold-ringed socials).
- Bottom band (own row): one SVG scene with stars, moon glow, far hills, a tree line, a snowy ridge, a five-building village with a lit church, mid evergreens with snow caps, a decorated tree with gifts, a lamp post, foreground drift and slow snowfall. `xMidYMax slice` keeps the village centred on tablet and phone.
- Motion: opacity/transform keyframes only, staggered and slow. All of it is off under reduced motion.
- Static SVG constants, inert (`aria-hidden`, no pointer events), no network, no JS. Every selector is scoped to `[data-event="christmas"]`.
- Globally (all themes): the standalone footer link whose label equals the publisher ("DYPOL LABS") is filtered at render. Settings are untouched and other saved footer links still render. The copyright note is untouched.

## t205 — Responsive art direction (plan; menu part superseded by t206)
Finding (t204): one 1200×220 scene with `xMidYMax slice` was just a centre crop. On phones it lost the decorated tree, gifts, moon and lamp, and it left a tall empty sky.
Approach: compose the scene separately per size. All three variants come from one generator (its output constants live in `event-decor-art.ts`) built from shared motifs (decorated tree, gifts, village, lamp, moon, hills, tree line, snow). Each variant places motifs for its own frame. CSS shows exactly one variant. Slicing only ever trims sky; motifs sit inside a "safe band", and a test checks that.
- Compact (<600: 320/360/400/540): 520×250. The decorated tree and gifts lead at left, a 3-building village (cottage, lit church, cottage) on the ridge, lamp right, small moon top-right. Fewer stars/flakes; the distant tree line is simplified.
- Medium (600–1099: 768/1024): 900×230. Tree + gifts left, 5-building village centre, lamp + moon right, mid evergreens spaced between.
- Wide (≥1100: 1440/1920): 1200×220, the full t204 composition. The moon is lowered so a capped height (sky trimmed) never cuts it.
- Height is `aspect-ratio` from the viewBox with a per-mode cap. Short landscape (max-height 500px) caps lower and hides the moon rather than half-cropping it.
- Garland: one long 2400-unit strand with a fixed band height per mode (52/60/70px) and `xMidYMin slice`. The scale is always height-driven, so swags are never squashed: about 3 swags on a phone, more on wider screens.
- Footer content (Christmas only): tighter top spacing, columns stack 2-up on phones with roomier link tap targets, copyright wraps balanced, no dead gap above the scene.
- Menu (t206 correction, owner): the menu design, background, spacing and buttons stay exactly original. The only change is that the existing event snowfall layer is lifted above the open menu (`html.nav-open … .event-particles { z-index: 31 }`, above the sticky header's z-index 30 stacking context). It is inert and hidden under reduced motion. The t205 menu garland/holly/texture was removed.
- Motion stays opacity/transform, and none under reduced motion. Cleanup: drop the single-scene CSS/markup and the t204 negative margin.

## t208 — New Year: "Midnight gala over the city" (plan)
Audit: the `newyear` theme and its preset (indigo/gold, sparkle effect, message) already existed in `EVENT_THEMES`, but nothing rendered for it beyond the generic ribbon and stripe. Reused that theme and preset; nothing is duplicated and Christmas is unchanged.
- Art direction: midnight indigo sky, champagne gold and ivory, with jewel accents (emerald, sapphire, ruby, amethyst). Sophisticated rather than party-store: an art-deco frieze, crafted fireworks, the clock at twelve.
- Top band (own row): a gold deco rule with repeating sunburst fans, jewel stars hanging on gold threads (gentle ±3° sway), ribbon streamers and twinkling glints. One 2400-unit strand at a fixed height (50/58/66px), like the Christmas garland.
- Scene (own row, composed per size like Christmas):
  - Compact (<600): "HAPPY NEW YEAR" with a large gold year as the centred headline, two fireworks in the top corners, a clock tower at left, a toast of two coupes at right, a two-layer lit skyline and a gold-rippled river.
  - Medium (600–1099): year centred, four fireworks, tower left, toast right.
  - Wide (≥1100): the same with more breathing room.
  The skyline is kept low under the headline so the year always reads.
- Year: `celebratedYear(event, now)` is "now" clamped into the event window. October onwards means next year, otherwise this year. It is month-based in UTC, so midnight in any time zone can't flip it, and an admin preview of a future event shows that event's year. Digits only, injected at render; no countdown.
- Logo: three small gold sparkles above the first letter (twinkle), like the hat (never over the lettering). No Christmas motifs.
- Particles: the existing `sparkle` effect (preset), already inert and lifted over the open menu by the t206 rule. The menu is not restyled.
- Motion: slow blooms (7.5s), twinkles, window glow, river shimmer, rising bubbles. Opacity/transform only, every cycle ≥4s (no strobing), all static under reduced motion.
- Preset: `newYearEvent(year)` (id `newyear`, 31 Dec → 2 Jan, OFF). It is in the defaults for fresh installs and in an "Add New Year" button in Admin → Events. Stored settings are never rewritten, so production's saved events stay as they are.

## t209 — Diwali, Holi, Eid; Valentine's Day removed (plan)
Audit (read-only): the themes were `christmas, newyear, halloween, valentines, custom`. There was no Diwali/Holi/Eid scaffolding and no Valentine art. Production's saved events are Christmas only (no Valentine row), so no production write is needed.
- Valentine's removal: the theme, preset, editor choice and message are gone. Stored data is migrated on read (`migrateLegacyEvents`): an event that is unmistakably the Valentine's event (legacy theme AND "valentine" in its id or name) is dropped. Any other event using the legacy theme keeps all its data as a Custom event, so nothing else is lost. New admin saves can't use the legacy theme. Production's Christmas-only config passes through byte-identical.
- Presets: Diwali, Holi and Eid have stable ids `diwali` / `holi` / `eid`. They are switched OFF with NO dates, because these festivals move every year (lunisolar and lunar calendars), and no religious dates are guessed. Admin → Events gets "Add Diwali / Add Holi / Add Eid" buttons that save normally. The status line asks the owner to set this year's dates first. Defaults stay Christmas + New Year.
- Diwali, "Festival of lights": plum/indigo night, saffron and gold.
  - Top band: a marigold toran (orange/yellow flower beads) with hanging strands and mango leaves that sway.
  - Scene: hanging star lanterns (akash kandil) that glow, a large rangoli in perspective, rows of clay diyas with slow flame flicker and halos, havelis with arched lit windows and string lights.
  - "HAPPY DIWALI" headline. Phone: lanterns in the corners, rangoli centre, two diyas each side.
- Holi, "Colours of spring": a deep berry night base keeps the footer text crisp, while the colour lives in the art (magenta, saffron, turquoise, lime, violet).
  - Top band: multi-colour bunting and soft powder puffs.
  - Scene: soft gulal powder clouds (radial gradients, slow breathe), flowing ribbons that drift, brass thalis with powder mounds, flowers, gently floating colour dust.
  - A multi-colour "HAPPY HOLI". Refined, not a confetti explosion.
- Eid, "Moonlit evening": navy/emerald with antique gold.
  - Top band: a geometric eight-point star band with small hanging lanterns.
  - Scene: a crescent with a star and a soft halo, a generic skyline of domes and arches (no specific building), fanous lanterns, a foreground arcade of pointed arches with a warm inner glow.
  - The greeting is "EID MUBARAK" (generic, not al-Fitr or al-Adha specific). No sacred text, no alcohol.
- Each theme: a phone/tablet/wide composition (motifs rearranged, a test checks for collisions), short-landscape caps, a tiny logo ornament above the first letter (diya / colour dots / crescent and star), a theme palette at ≥7:1 text contrast, existing particles (sparkle / confetti / sparkle) lifted over the open menu with no menu restyle. Motion is opacity/transform only, ≥3.6s cycles, static under reduced motion. Each theme's CSS is scoped to its own `[data-event]`.

## t210 — Editable display year and date-only schedules

**Year.** Each event has an optional `year` (integer 2000–2100, validated by zod on save and on read;
empty/absent = automatic). Admin field "Year shown in design" (native number input, placeholder shows
the automatic value). `celebratedYear()` returns an explicit year first — it is never replaced by the
schedule, today's date, or sanitisation — otherwise the automatic year from the dates. The New Year
footer (all three variants, normal and Special routes, `?event=` preview) renders it via
`newYearMarkup`, which only ever writes digits. Other themes store the field but show no year text.

**Dates.** Scheduling is date-only (`<input type="date">`, no time controls), always in India time
(Asia/Kolkata, UTC+05:30) regardless of the browser zone. Both dates are inclusive:
start = 00:00 IST of the start date, end = 23:59:59.999 IST of the end date (= next day 00:00 IST
exclusive). Same-day events are allowed; either date may be blank (open-ended).

**Storage / back-compat.** The stored fields stay `startsAt`/`endsAt` ISO instants, so the runtime
resolver, status line and preview are unchanged. Helpers in `src/lib/events.ts`: `parseDateOnly`
(strict calendar validation, leap years, no `new Date("YYYY-MM-DD")`), `startOfDateIST`,
`endOfDateIST`, `istDateOf`. Admin saves (`parseEvents(raw, previous)`) require a start on an IST
midnight and an end on an IST day end; the only exception is a legacy timestamp identical to the value
already stored for the same event id, so saving other edits never shifts a live schedule. Reads never
rewrite records. Legacy instants display as their IST date (e.g. an old end of 2027-01-02T23:59Z shows
as 3 Jan); picking a date converts that field to the new semantics.

**Presets.** Christmas: 1 Dec – 6 Jan IST; New Year: 31 Dec – 2 Jan IST; new custom draft: today + 13
days. Existing stored events are not migrated.

## t211 — One generic editor, no separate New Year card

The admin Events tab has a single **Add event** button; the design (Christmas, New Year, Diwali, Holi,
Eid, Halloween, Custom) is chosen from each event's Design dropdown. The "Add New Year / Diwali / Holi /
Eid" buttons are gone and `defaultEvents()` (used only when no settings row exists) seeds just one
switched-off Christmas example — no New Year card. Switching design keeps the event's name, year, dates
and on/off state; it updates effect and colours, and the message only if it was still the old preset's.
Multiple events stay supported. Stored rows are never filtered on read: removing the existing redundant
production `newyear` row is a one-off, targeted edit of that exact row (see release notes), not a migration.

## t212 — Halloween design

Halloween (already in the Design dropdown) now uses the festival pipeline like Diwali/Holi/Eid:
`FESTIVAL_THEMES` includes `halloween`; `FESTIVAL_ART.halloween` has a bunting frieze (orange/purple
pennants with small swaying pumpkins) and three composed scenes — wide/medium/compact — of a
moonlit plum sky, stars, friendly bats, a crooked village with lit windows, bare trees and carved
smiling pumpkins, with "HAPPY HALLOWEEN". Short-landscape caps the band height. Logo gets a tiny
pumpkin ornament. Motion: bat glide (9–13 s), wing flutter (3.6 s), candle glow, star twinkle,
bunting sway — transform/opacity only, all static under reduced motion; decorations are
`aria-hidden` and `pointer-events: none`. Menu, buttons and core styles untouched; the event's
existing particle effect is unchanged. Any stored event whose theme is `halloween` (including the
live card) gets the new art automatically with no settings change.

## t213/t214 — Save-then-card editor and automatic lifecycle

**Editor.** One form at the top (Add event → New event, or Edit on a card loads it there). Save
persists, closes the form and shows the event as a compact card under "Saved events" (name, design,
year, date range, status tag, Edit / Preview / Delete). Cancel discards (asks if unsaved). New events
start Active; untick "Active" to pause. No per-theme buttons; design comes from the dropdown.

**Tags.** Upcoming (before start date) · Ongoing (the event being applied now) · "Scheduled · another
event is showing" (inside its dates but another live event wins) · Paused (switched off) · Expired
(after the inclusive end date; "Expired · paused" if it was also off).

**Automatic on/off** is the existing server-side resolver (date-only IST, inclusive end) — no browser.

**Retention and deletion (t214, supersedes "delete at expiry").** An expired event stays as an
Expired card for 7 days, then is deleted from storage. Deadline = max(exclusive end = next-day 00:00
IST, last meaningful saved edit) + 7 days (`purgeDeadline`). `editedAt` is stamped by the server only
(`stampEdits`): a new event or any changed field sets it to now; a no-op save keeps the stored value;
reads, previews and page views never change it; a browser-sent value is ignored. Legacy rows without
`editedAt` use the end date. Open-ended or undated events are never deleted. The clean-up
(`sweepExpiredEvents`) runs on the normal server request path (public pages and the admin tab) — the
app has no cron — and writes only when an event is past its deadline, with a compare-and-swap on the
exact stored row text. Admin saves are compare-and-swap too: the editor sends the row signature it
loaded; if the row changed meanwhile (another tab or the clean-up) the save is refused with "reload and
try again" instead of overwriting. Content cache is invalidated by the usual site_settings write bump.

Also: Eid arcade arches now close on a sill above a floor band (no arches running off the frame);
Holi particles use vivid powder colours (particle layer only).

### t214 — hourly cron

`src/server.ts` is now the Worker entry: it forwards every request unchanged to TanStack Start's
generated handler (`@tanstack/react-start/server-entry`) and adds `scheduled`. `wrangler.jsonc` has
`"main": "src/server.ts"` and `"triggers": { "crons": ["17 * * * *"] }` (hourly, minute 17).
`dispatchScheduled` (src/lib/scheduled.ts) runs the events clean-up only for that exact cron, using
the trigger's scheduledTime as the clock; failures are logged and retried next hour. The clean-up core
`sweepStore` (pure, in events.ts) deletes an event once now ≥ its deadline, where deadline = max(first moment after the inclusive end date, last meaningful saved edit) + 7 days (the 7 days are counted once), writes nothing when
nothing is due, never stamps `editedAt`, and swaps the row only if its text is unchanged (a concurrent
admin save wins; the next run re-evaluates). The on-request sweep stays as a fallback. Deletion can
therefore lag the deadline by up to ~1 hour (or happen sooner on a page view).
