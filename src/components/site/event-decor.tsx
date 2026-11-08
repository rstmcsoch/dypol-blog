/**
 * t203: Christmas-only decorations (rendered only while the Christmas event is shown).
 * Inline SVG, no images or dependencies; decorative only (aria-hidden, no pointer events).
 * Motion is CSS transform/opacity in styles-events.css and stops under reduced motion.
 */

/** A small tilted Santa hat that sits above the wordmark's first letter without covering it. */
export function SantaHat() {
  return (
    <svg className="event-hat" viewBox="0 0 64 48" aria-hidden="true" focusable="false">
      <path className="event-hat__cap" d="M8 38 C14 20 26 8 42 6 C50 5 56 10 58 18 C54 14 48 13 44 16 C40 20 40 30 42 38 Z" />
      <rect className="event-hat__brim" x="4" y="34" width="44" height="10" rx="5" />
      <circle className="event-hat__pom" cx="57" cy="22" r="5.5" />
    </svg>
  );
}

/** A sparse strip of evergreens with one gently swinging bell, in its own row below the footer text. */
export function ChristmasFooterScene() {
  return (
    <div className="container event-footer-scene" aria-hidden="true">
      <svg className="event-footer-scene__art" viewBox="0 0 320 64" preserveAspectRatio="xMidYMax meet" focusable="false">
        <g className="event-tree event-tree--1">
          <path d="M40 10 L56 34 H48 L62 54 H18 L32 34 H24 Z" />
          <rect x="37" y="54" width="6" height="8" rx="1" />
        </g>
        <g className="event-tree event-tree--2">
          <path d="M84 22 L96 40 H90 L100 56 H68 L78 40 H72 Z" />
          <rect x="81.5" y="56" width="5" height="6" rx="1" />
        </g>
        <g className="event-bell">
          <path className="event-bell__line" d="M160 0 V10" />
          <path className="event-bell__body" d="M148 34 C148 20 152 13 160 13 C168 13 172 20 172 34 L175 38 H145 Z" />
          <circle className="event-bell__clapper" cx="160" cy="41" r="3" />
        </g>
        <g className="event-tree event-tree--3">
          <path d="M236 18 L250 38 H243 L255 56 H217 L229 38 H222 Z" />
          <rect x="233.5" y="56" width="5" height="6" rx="1" />
        </g>
        <g className="event-tree event-tree--4">
          <path d="M282 28 L292 42 H287 L295 56 H269 L277 42 H272 Z" />
          <rect x="280" y="56" width="4" height="6" rx="1" />
        </g>
        <path className="event-footer-scene__ground" d="M0 62.5 H320" />
      </svg>
    </div>
  );
}
