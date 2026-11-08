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
