import { useEffect, useRef } from "react";
import { useSite } from "./use-site";

type TeamMember = {
  name: string;
  role: string;
};

type TeamGroup = {
  id: string;
  kicker: string;
  title: string;
  note: string;
  members: TeamMember[];
};

const TEAM_GROUPS: TeamGroup[] = [
  {
    id: "leadership",
    kicker: "Editorial leadership",
    title: "The desk that sets the line",
    note: "Direction, standards and final editorial judgment.",
    members: [
      { name: "Rowan Grant", role: "Editor-in-Chief" },
      { name: "Henrik Lindqvist", role: "Managing Editor" },
      { name: "Saanvi Joshi", role: "Deputy Editor" },
      { name: "Mira Solberg", role: "Senior Editor" },
    ],
  },
  {
    id: "copy",
    kicker: "Copy desk",
    title: "Clarity, before anything goes live",
    note: "Line edits, accuracy checks and the final polish.",
    members: [{ name: "Aisha Rahman", role: "Copy Editor" }],
  },
  {
    id: "senior-staff",
    kicker: "Senior staff writers",
    title: "Experienced voices on the beat",
    note: "Deep reporting across the stories that matter.",
    members: [
      { name: "Lucas Bennett", role: "Senior Staff Writer" },
      { name: "Akira Fujita", role: "Senior Staff Writer" },
      { name: "Sophie Williams", role: "Senior Staff Writer" },
    ],
  },
  {
    id: "staff",
    kicker: "Staff writers",
    title: "The reporting engine",
    note: "Daily coverage, research and sharp explainers.",
    members: [
      { name: "Advait Sharma", role: "Staff Writer" },
      { name: "Samir Nasser", role: "Staff Writer" },
      { name: "Yasmin Nasser", role: "Staff Writer" },
      { name: "Ishikawa Yusei", role: "Staff Writer" },
      { name: "Elena Vance", role: "Staff Writer" },
      { name: "Arjun Mehta", role: "Staff Writer" },
      { name: "Freya Dalton", role: "Staff Writer" },
      { name: "Shanaya Negi", role: "Staff Writer" },
      { name: "Paisley Warren", role: "Staff Writer" },
      { name: "Carson Walker", role: "Staff Writer" },
    ],
  },
];

const TOTAL = TEAM_GROUPS.reduce((n, g) => n + g.members.length, 0);

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function useReveal(root: React.RefObject<HTMLElement | null>) {
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
  }, [root]);
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

export function TeamPage() {
  const site = useSite();
  const root = useRef<HTMLDivElement | null>(null);
  const hero = useRef<HTMLElement | null>(null);
  useReveal(root);
  useHeroParallax(hero);

  let index = 0;
  return (
    <div className="team-page" ref={root}>
      <section className="team-hero" ref={hero} aria-labelledby="team-title">
        <div className="container team-hero__inner">
          <div className="team-hero__copy" data-reveal>
            <p className="kicker">{site.name} / Editorial</p>
            <h1 id="team-title" className="team-hero__title">
              <span className="team-hero__title-line">The people</span>
              <span className="team-hero__title-line">behind the <span className="team-hero__accent">story.</span></span>
            </h1>
            <p className="team-hero__lede">
              DYPOL Blog is made by editors and writers who care about clarity, accuracy and the craft of
              a good tech story. Meet the newsroom behind every headline.
            </p>
          </div>
          <div className="team-hero__visual" aria-hidden="true">
            <div className="team-hero__mark team-hero__mark--back">
              <span className="team-hero__mark-text">TEAM</span>
            </div>
            <div className="team-hero__mark team-hero__mark--front">
              <span className="team-hero__count">{String(TOTAL).padStart(2, "0")}</span>
              <span className="team-hero__count-label">People in the newsroom</span>
            </div>
          </div>
        </div>
        <div className="container">
          <div className="team-hero__stats" data-reveal>
            {TEAM_GROUPS.map((group) => (
              <div key={group.id} className="team-stat">
                <span className="team-stat__value">{String(group.members.length).padStart(2, "0")}</span>
                <span className="team-stat__label">{group.kicker}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {TEAM_GROUPS.map((group) => (
        <section key={group.id} className="team-group" aria-labelledby={`team-${group.id}-title`}>
          <div className="container">
            <header className="team-group__head" data-reveal>
              <div>
                <p className="kicker">{group.kicker}</p>
                <h2 id={`team-${group.id}-title`} className="team-group__title">{group.title}</h2>
              </div>
              <p className="team-group__note">{group.note}</p>
            </header>
            <div className={`team-grid team-grid--${group.id}`} role="list">
              {group.members.map((member) => {
                index += 1;
                const n = String(index).padStart(2, "0");
                return (
                  <article
                    key={`${group.id}-${member.name}`}
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

      <section className="team-note" aria-label="Editorial note">
        <div className="container">
          <div className="team-note__panel" data-reveal>
            <p className="kicker">Editorial note</p>
            <p className="team-note__text">
              Writer seniority and the Copy Editor assignment are provisional, pending confirmation of
              individual experience and editing responsibilities.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
