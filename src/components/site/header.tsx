import { useEffect, useRef, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { NavItem } from "@/content/types";
import { NavLink } from "./nav-link";
import { ThemeToggle } from "./theme-toggle";
import { useMenuTopics, useSite, type MenuTopic } from "./use-site";

const TOPIC_PREFIX = "/topics/";

/** Which visible item owns the current page (exact page, or the section it lives in). */
function sectionOwner(items: NavItem[], pathname: string): string | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  const exact = items.find((item) => item.href === path);
  if (exact) return null; // the router marks exact matches itself (aria-current="page")
  if (path.startsWith(TOPIC_PREFIX)) return items.find((item) => item.href === "/topics")?.id ?? null;
  return null;
}

export function SiteHeader() {
  const site = useSite();
  const menuTopics = useMenuTopics();
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // A topic shortcut shows only while its topic exists and has published stories
  // (counts unknown = content layer down: show the owner's menu as saved).
  const live = (item: NavItem) => {
    if (!item.visible) return false;
    if (!item.href.startsWith(TOPIC_PREFIX) || menuTopics === null) return true;
    return menuTopics.some((t) => `${TOPIC_PREFIX}${t.slug}` === item.href);
  };
  const items = site.nav.filter(live);
  const section = sectionOwner(items, pathname);
  const countFor = (item: NavItem): MenuTopic | undefined => menuTopics?.find((t) => `${TOPIC_PREFIX}${t.slug}` === item.href);
  const shortcutHrefs = new Set(items.map((item) => item.href));
  const popular = (menuTopics ?? [])
    .filter((t) => !shortcutHrefs.has(`${TOPIC_PREFIX}${t.slug}`))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 6);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("nav-open", open);
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("a")?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    // Back to the desktop layout: the phone menu has nothing to show.
    const wide = window.matchMedia("(min-width: 960px)");
    const onWide = () => wide.matches && setOpen(false);
    window.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    return () => {
      root.classList.remove("nav-open");
      window.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
    };
  }, [open]);

  return (
    <header className="site-header">
      <div className="container bar">
        <NavLink href="/" className="wordmark">
          {site.logoMediaId ? <img className="wordmark__logo" src={`/media/${site.logoMediaId}`} alt="" /> : null}
          <span className="wordmark__name">DYPOL</span>
          <span className="wordmark__stamp grain">
            <span>Blog</span>
          </span>
        </NavLink>
        <nav id="site-nav" className={open ? "site-nav is-open" : "site-nav"} aria-label={site.labels.primaryNav}>
          <div className="site-nav__inner" ref={panel}>
            <ul className="site-nav__list">
              {items.map((item) => {
                const topic = item.href.startsWith(TOPIC_PREFIX);
                const count = countFor(item)?.count;
                return (
                  <li key={item.id}>
                    <NavLink href={item.href} className={topic ? "nav-link nav-link--topic" : "nav-link"} section={section === item.id} onNavigate={() => setOpen(false)}>
                      <span className="nav-link__label">{item.label}</span>
                      {topic && count ? (
                        <span className="nav-link__count" aria-hidden="true">
                          {String(count).padStart(2, "0")}
                        </span>
                      ) : null}
                      <ArrowRight className="nav-link__arrow" aria-hidden="true" strokeWidth={2.25} />
                    </NavLink>
                  </li>
                );
              })}
            </ul>
            {popular.length > 0 ? (
              <div className="site-nav__topics">
                <p className="site-nav__heading">{site.labels.menuTopics}</p>
                <ul className="nav-chips">
                  {popular.map((t) => (
                    <li key={t.slug}>
                      <Link to="/topics/$slug" params={{ slug: t.slug }} className="nav-chip" onClick={() => setOpen(false)}>
                        <span>{t.label}</span>
                        <span className="nav-chip__count" aria-hidden="true">
                          {t.count}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <Link to="/topics" className="btn btn--accent grain site-nav__all" onClick={() => setOpen(false)}>
                  {site.labels.menuAllTopics}
                  <ArrowRight aria-hidden="true" strokeWidth={2.5} />
                </Link>
              </div>
            ) : null}
          </div>
        </nav>
        <div className="bar-tools">
          <ThemeToggle />
          <button
            ref={button}
            type="button"
            className={open ? "menu-btn grain" : "menu-btn"}
            aria-expanded={open}
            aria-controls="site-nav"
            onClick={() => setOpen((value) => !value)}
          >
            <span className="menu-btn__icon" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="menu-btn__label">{open ? site.labels.close : site.labels.menu}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
