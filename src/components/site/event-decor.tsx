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

import { FESTIVAL_ART, FESTIVAL_THEMES, GARLAND, NY_FRIEZE, NY_LAYOUT, SCENES, SCENE_LAYOUT, SCENE_MODES, newYearMarkup, type FestivalTheme } from "./event-decor-art";

export { FESTIVAL_THEMES, type FestivalTheme };

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

/** t209: Diwali / Holi / Eid top band (same fixed-height strand approach as the garland). */
export function FestivalFrieze({ theme }: { theme: FestivalTheme }) {
  return (
    <div className={`fest-frieze fest-frieze--${theme}`} aria-hidden="true">
      <svg viewBox="0 0 2400 70" preserveAspectRatio="xMidYMin slice" focusable="false" dangerouslySetInnerHTML={{ __html: FESTIVAL_ART[theme].frieze }} />
    </div>
  );
}

/** t209: the festival scene, composed separately for phone, tablet and wide screens. */
export function FestivalFooterScene({ theme }: { theme: FestivalTheme }) {
  const art = FESTIVAL_ART[theme];
  return (
    <div className={`fest-scene fest-scene--${theme}`} aria-hidden="true">
      {SCENE_MODES.map((mode) => (
        <svg
          key={mode}
          className={`fest-scene__v fest-scene__v--${mode}`}
          viewBox={`0 0 ${art.layout[mode].w} ${art.layout[mode].h}`}
          preserveAspectRatio="xMidYMax slice"
          focusable="false"
          dangerouslySetInnerHTML={{ __html: art.scenes[mode] }}
        />
      ))}
    </div>
  );
}

/** t209: tiny logo ornament above the first letter (never over the lettering). */
export function FestivalOrnament({ theme }: { theme: FestivalTheme }) {
  return (
    <svg className={`event-ornament event-ornament--${theme}`} viewBox="0 0 40 28" aria-hidden="true" focusable="false">
      {theme === "diwali" ? (
        <>
          <path className="event-ornament__clay" d="M6 22Q8 27 16 27Q24 27 26 22Q16 24 6 22Z" />
          <path className="event-ornament__flame" d="M16 4C20 10 20 15 16 20C12 15 12 10 16 4Z" />
        </>
      ) : theme === "halloween" ? (
        <>
          <ellipse className="event-ornament__pk" cx="12" cy="20" rx="5" ry="6" />
          <ellipse className="event-ornament__pk" cx="20" cy="20" rx="5" ry="6" />
          <ellipse className="event-ornament__pk2" cx="16" cy="20" rx="4.6" ry="6.4" />
          <path className="event-ornament__stem" d="M15.4 14q.6-3.4 3-4l.6 1.2q-1.8.8-2 2.8z" />
          <path className="event-ornament__face" d="M12.6 19l1.4-2 1.4 2zM16.6 19l1.4-2 1.4 2zM12.5 21.6q3.5 2.6 7 0q-3.5 1-7 0z" />
        </>
      ) : theme === "holi" ? (
        <>
          <circle className="event-ornament__a" cx="9" cy="16" r="5" />
          <circle className="event-ornament__b" cx="19" cy="10" r="5.5" />
          <circle className="event-ornament__c" cx="29" cy="17" r="4.5" />
        </>
      ) : (
        <>
          <path className="event-ornament__moon" d="M16 3A11 11 0 1 0 16 25A7 11 0 1 1 16 3Z" />
          <path className="event-ornament__star" d="M27 8l1.3 3.7 3.7 1.3-3.7 1.3L27 18l-1.3-3.7L22 13l3.7-1.3z" />
        </>
      )}
    </svg>
  );
}
