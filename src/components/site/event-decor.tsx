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

import { GARLAND, SCENES, SCENE_LAYOUT, SCENE_MODES, SPRIG } from "./event-decor-art";

/** One long evergreen strand: CSS fixes the band height per size, so the swag density adapts and nothing is squashed. */
export function ChristmasGarland({ className = "xmas-garland" }: { className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      <svg viewBox="0 0 2400 70" preserveAspectRatio="xMidYMin slice" focusable="false" dangerouslySetInnerHTML={{ __html: GARLAND }} />
    </div>
  );
}

/** Night-time winter village, composed separately for phone, tablet and wide screens. */
export function ChristmasFooterScene() {
  return (
    <div className="xmas-scene" aria-hidden="true">
      {SCENE_MODES.map((mode) => (
        <svg
          key={mode}
          className={`xmas-scene__v xmas-scene__v--${mode}`}
          viewBox={`0 0 ${SCENE_LAYOUT[mode].w} ${SCENE_LAYOUT[mode].h}`}
          preserveAspectRatio="xMidYMax slice"
          focusable="false"
          dangerouslySetInnerHTML={{ __html: SCENES[mode] }}
        />
      ))}
    </div>
  );
}

/** Festive accents for the open mobile menu: garland strip, snow texture (CSS) and a holly sprig. */
export function ChristmasMenuDecor() {
  return (
    <div className="xmas-menu" aria-hidden="true">
      <ChristmasGarland className="xmas-menu__garland" />
      <svg className="xmas-menu__sprig" viewBox="0 0 140 100" focusable="false" dangerouslySetInnerHTML={{ __html: SPRIG }} />
    </div>
  );
}
