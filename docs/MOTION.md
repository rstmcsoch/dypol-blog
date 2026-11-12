# t220 motion plan

Slight, professional motion on the existing public and admin surfaces. No redesign.

## Current behaviour
- Public route changes swap instantly. Article/special routes already show a skeleton only after 200ms of real pending (prefetch usually makes this rare). No route animation, and `scroll-behavior: smooth` is already limited to TOC / Back to top — not route restoration.
- Popups: the external-link dialog animates in (160ms) but closes instantly. Admin account and notification menus, and the display-settings drawer, animate in and unmount with no exit. Admin delete/preview `<dialog>`s and consent bars have no motion. The public mobile menu toggles opacity/visibility with no transition; its layout, colours and seasonal particles stay as they are.
- Share controls are links, not a popup. Event decoration loops stay as they are.

## Approach
Native CSS only (transitions / short keyframes). Tokens: `--motion: 180ms`, `--motion-exit: 140ms`, opacity and a small translate (≤8px) only. No animation libraries. No View Transitions API: it can fight scroll restoration, the sticky header and Back to top.

1. **Routes (article open, back/forward, other public pages).** After hydration only, the public `#content` outlet gets a 180ms fade + 6px rise on pathname change. First SSR/hydration paint is static (no class, no mismatch). Hash-only changes (TOC) are skipped. Admin/preview shells are skipped. Existing `pendingMs: 200` stays: skeletons only for a real wait, never an artificial delay.
2. **Dialogs** (`leave-dialog`, `adm-dialog`, homepage preview). Enter and exit via `transition` + `@starting-style` on the dialog and backdrop, so `showModal()` / `close()` / Escape / focus stay as they are. No delayed unmount.
3. **Menus that unmount** (account, notifications, display settings). A small `usePresence` hook keeps the node mounted for the exit duration, then removes it and clears the timer. `aria-expanded` still follows the real open state.
4. **Public mobile menu.** Opacity/visibility transition only, inside the existing ≤959px rules. No restyle. Seasonal particles unchanged.
5. **Consent bars.** Enter only (fade/rise). Exit is left instant so accepting cookies is not delayed.

## Reduced motion, performance, out of scope
`prefers-reduced-motion: reduce` sets durations to 0 and disables these animations. Keyboard, touch and focus behaviour stay the same. No layout properties, no content delay, no LCP hold, no new infinite decorative loops. Back to top, TOC smooth scroll, events, Sharing, settings tabs, homepage memory-only preview and the account avatar are unchanged.
