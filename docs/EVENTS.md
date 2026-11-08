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
