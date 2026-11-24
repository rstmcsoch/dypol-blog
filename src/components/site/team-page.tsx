import { useEffect, useRef } from "react";
import { teamMemberCount, type TeamSettings } from "@/lib/team";
import { useSite } from "./use-site";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function useReveal(root: React.RefObject<HTMLElement | null>, key?: unknown) {
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const items = Array.from(node.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (reduce || !("IntersectionObserver" in window)) {
      items.forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    items.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [root, key]);
}

function useHeroParallax(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const update = () => {
      frame = 0;
      if (reduce.matches) {
        el.style.setProperty("--team-parallax", "0px");
        el.style.setProperty("--team-parallax-slow", "0px");
        return;
      }
      const rect = el.getBoundingClientRect();
      const progress = Math.min(Math.max(-rect.top, 0), rect.height + window.innerHeight);
      el.style.setProperty("--team-parallax", `${progress * 0.08}px`);
      el.style.setProperty("--team-parallax-slow", `${progress * 0.035}px`);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    reduce.addEventListener?.("change", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      reduce.removeEventListener?.("change", onScroll);
    };
  }, [ref]);
}

function HeroTitle({ title }: { title: string }) {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const last = words[words.length - 1];
  const lead = words.slice(0, -1).join(" ");
  return (
    <>
      {lead ? <span className="team-hero__title-line">{lead} </span> : null}
      <span className="team-hero__title-line"><span className="team-hero__accent">{last}</span></span>
    </>
  );
}

export function TeamPage({ team }: { team: TeamSettings }) {
  const site = useSite();
  const root = useRef<HTMLDivElement | null>(null);
  const hero = useRef<HTMLElement | null>(null);
  useReveal(root, team);
  useHeroParallax(hero);

  const total = teamMemberCount(team);
  let index = 0;
  return (
    <div className="team-page" ref={root} data-team-version={String(total)}>
      <section className="team-hero" ref={hero} aria-labelledby="team-title">
        <div className="container team-hero__inner">
          <div className="team-hero__copy" data-reveal>
            <p className="kicker">{team.kicker || `${site.name} / Editorial`}</p>
            <h1 id="team-title" className="team-hero__title">
              <HeroTitle title={team.title} />
            </h1>
            <p className="team-hero__lede">{team.lede}</p>
          </div>
          <div className="team-hero__visual" aria-hidden="true">
            <div className="team-hero__mark team-hero__mark--back">
              <span className="team-hero__mark-text">TEAM</span>
            </div>
            <div className="team-hero__mark team-hero__mark--front">
              <span className="team-hero__count">{String(total).padStart(2, "0")}</span>
              <span className="team-hero__count-label">People in the newsroom</span>
            </div>
          </div>
        </div>
        <div className="container">
          <div className="team-hero__stats" data-reveal>
            {team.groups.map((group) => (
              <div key={group.id} className="team-stat">
                <span className="team-stat__value">{String(group.members.length).padStart(2, "0")}</span>
                <span className="team-stat__label">{group.kicker}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {team.groups.map((group) => (
        <section key={group.id} className="team-group" aria-labelledby={`team-${group.id}-title`}>
          <div className="container">
            <header className="team-group__head" data-reveal>
              <div>
                <p className="kicker">{group.kicker}</p>
                <h2 id={`team-${group.id}-title`} className="team-group__title">{group.title}</h2>
              </div>
              {group.note ? <p className="team-group__note">{group.note}</p> : null}
            </header>
            <div className={`team-grid team-grid--${group.id}`} role="list">
              {group.members.map((member) => {
                index += 1;
                const n = String(index).padStart(2, "0");
                return (
                  <article
                    key={member.id || `${group.id}-${member.name}`}
                    className="team-card"
                    role="listitem"
                    data-reveal
                    style={{ ["--reveal-delay" as string]: `${(index % 6) * 60}ms` }}
                  >
                    <div className="team-card__top">
                      <span className="team-card__index" aria-hidden="true">{n}</span>
                      <span className="team-card__seal" aria-hidden="true">
                        <span className="team-card__initials">{initials(member.name)}</span>
                      </span>
                    </div>
                    <div className="team-card__body">
                      <p className="team-card__role">{member.role}</p>
                      <h3 className="team-card__name">{member.name}</h3>
                    </div>
                    <div className="team-card__foot" aria-hidden="true">
                      <span className="team-card__line" />
                      <span className="team-card__desk">{group.kicker}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      ))}

    </div>
  );
}
