import { useEffect, useState, type CSSProperties } from "react";
import type { EventTheme, SiteEvent } from "@/lib/events";

/**
 * Public seasonal layer: a message bar above the header plus one inert field of
 * CSS-animated particles. Rendered from the root layout so it covers every
 * page; it adds no layout, colour or behaviour changes to the site itself.
 *
 * The flakes are a fixed table (no Math.random) so server and client markup
 * match, and animations are CSS-only: no canvas, no requestAnimationFrame.
 */
type Flake = { left: number; delay: number; duration: number; size: number; drift: number };

const FLAKES: Flake[] = [
  { left: 3, delay: 0, duration: 13, size: 5, drift: 20 },
  { left: 9, delay: 6, duration: 17, size: 4, drift: -24 },
  { left: 14, delay: 2, duration: 11, size: 6, drift: 12 },
  { left: 20, delay: 9, duration: 15, size: 3, drift: 30 },
  { left: 26, delay: 4, duration: 19, size: 5, drift: -18 },
  { left: 32, delay: 12, duration: 12, size: 4, drift: 24 },
  { left: 38, delay: 1, duration: 16, size: 6, drift: -30 },
  { left: 44, delay: 7, duration: 10, size: 3, drift: 16 },
  { left: 50, delay: 3, duration: 14, size: 5, drift: -12 },
  { left: 56, delay: 10, duration: 18, size: 4, drift: 34 },
  { left: 62, delay: 5, duration: 12, size: 6, drift: -22 },
  { left: 68, delay: 13, duration: 15, size: 3, drift: 18 },
  { left: 74, delay: 2, duration: 17, size: 5, drift: -28 },
  { left: 80, delay: 8, duration: 11, size: 4, drift: 22 },
  { left: 86, delay: 0.5, duration: 19, size: 6, drift: -16 },
  { left: 91, delay: 11, duration: 13, size: 4, drift: 26 },
  { left: 95, delay: 4.5, duration: 16, size: 5, drift: -34 },
  { left: 98, delay: 6.5, duration: 12, size: 3, drift: 14 },
];

function EventOrnament({ theme }: { theme: EventTheme }) {
  if (theme === "christmas") {
    return (
      <svg className="event-ribbon__orn" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        <path d="M12 2v20M2 12h20M5 5l14 14M19 5L5 19" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg className="event-ribbon__orn" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M12 2l2.7 7.3L22 12l-7.3 2.7L12 22l-2.7-7.3L2 12l7.3-2.7z" fill="currentColor" />
    </svg>
  );
}

export function SiteEventLayer({ event }: { event: SiteEvent | null }) {
  const [dismissed, setDismissed] = useState(false);
  const eventId = event?.id ?? null;

  // Dismissal lasts for this browser session only; the decorations stay.
  useEffect(() => {
    if (!eventId) return;
    try {
      const hidden = window.sessionStorage.getItem(`dypol-event-dismissed:${eventId}`) === "1";
      setDismissed(hidden);
      if (!hidden) document.documentElement.removeAttribute("data-event-dismissed");
    } catch {
      setDismissed(false);
    }
  }, [eventId]);

  if (!event) return null;

  const showBanner = event.banner && event.message.trim().length > 0 && !dismissed;
  const showParticles = event.effect !== "none";
  const external = /^https:\/\//i.test(event.ctaHref);

  const dismiss = () => {
    setDismissed(true);
    document.documentElement.setAttribute("data-event-dismissed", "");
    try {
      window.sessionStorage.setItem(`dypol-event-dismissed:${event.id}`, "1");
    } catch {
      /* private mode */
    }
  };

  return (
    <>
      {showParticles ? (
        <div className="event-particles" data-effect={event.effect} data-intensity={event.intensity} aria-hidden="true">
          {FLAKES.map((flake, index) => (
            <i
              key={index}
              className="event-particles__piece"
              style={
                {
                  left: `${flake.left}%`,
                  "--piece-size": `${flake.size}px`,
                  "--drift": `${flake.drift}px`,
                  animationDelay: `-${flake.delay}s`,
                  animationDuration: `${flake.duration}s`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      ) : null}
      {showBanner ? (
        <script
          // t202: hide an already-dismissed ribbon before first paint (no flash, no layout shift).
          dangerouslySetInnerHTML={{
            __html: `try{if(sessionStorage.getItem(${JSON.stringify(`dypol-event-dismissed:${event.id}`).replace(/</g, "\\u003c")})==="1")document.documentElement.setAttribute("data-event-dismissed","")}catch(e){}`,
          }}
        />
      ) : null}
      {showBanner ? (
        <div className="event-ribbon" role="region" aria-label={`${event.name} event`}>
          <div className="event-ribbon__inner container">
            <EventOrnament theme={event.theme} />
            <p className="event-ribbon__text">{event.message}</p>
            {event.ctaLabel && event.ctaHref ? (
              <a className="event-ribbon__cta" href={event.ctaHref} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>
                {event.ctaLabel}
              </a>
            ) : null}
            <button type="button" className="event-ribbon__close" onClick={dismiss} aria-label="Dismiss this event message">
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
