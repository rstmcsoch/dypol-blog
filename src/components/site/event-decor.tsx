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

import { GARLAND, NY_FRIEZE, NY_LAYOUT, SCENES, SCENE_LAYOUT, SCENE_MODES, newYearMarkup } from "./event-decor-art";

/** One long evergreen strand: CSS fixes the band height per size, so the swag density adapts and nothing is squashed. */
export function ChristmasGarland() {
  return (
    <div className="xmas-garland" aria-hidden="true">
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

/** t208: three small gold sparkles above the wordmark's first letter (never over the lettering). */
export function LogoSparkle() {
  return (
    <svg className="event-sparkle" viewBox="0 0 40 28" aria-hidden="true" focusable="false">
      <path className="event-sparkle__a" d="M12 2l2.2 6.8L21 11l-6.8 2.2L12 20l-2.2-6.8L3 11l6.8-2.2z" />
      <path className="event-sparkle__b" d="M29 4l1.3 3.7L34 9l-3.7 1.3L29 14l-1.3-3.7L24 9l3.7-1.3z" />
      <path className="event-sparkle__c" d="M24 18l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z" />
    </svg>
  );
}

/** t208: art-deco gold frieze with hanging jewel stars and streamers across the top of the footer. */
export function NewYearFrieze() {
  return (
    <div className="ny-frieze" aria-hidden="true">
      <svg viewBox="0 0 2400 70" preserveAspectRatio="xMidYMin slice" focusable="false" dangerouslySetInnerHTML={{ __html: NY_FRIEZE }} />
    </div>
  );
}

/** t208: midnight skyline, clock tower at twelve, slow-blooming fireworks, the celebrated year, a toast. */
export function NewYearFooterScene({ year }: { year: number }) {
  return (
    <div className="ny-scene" aria-hidden="true">
      {SCENE_MODES.map((mode) => (
        <svg
          key={mode}
          className={`ny-scene__v ny-scene__v--${mode}`}
          viewBox={`0 0 ${NY_LAYOUT[mode].w} ${NY_LAYOUT[mode].h}`}
          preserveAspectRatio="xMidYMax slice"
          focusable="false"
          dangerouslySetInnerHTML={{ __html: newYearMarkup(mode, year) }}
        />
      ))}
    </div>
  );
}
