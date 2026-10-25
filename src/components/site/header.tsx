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
  const header = useRef<HTMLElement>(null);

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
    if (!open) return;
    const root = document.documentElement;
    const body = document.body;
    const head = header.current;
    // Scroll lock (t112). The old lock set overflow:hidden on <html> AND <body>,
    // which turned <body> into the scroll container of the sticky header: once
    // the page was scrolled, the header (and the menu inside it) snapped back to
    // the document top, i.e. off-screen, leaving a locked page with no Close.
    // Now: pin <body> at its current offset, pin the header to the viewport, and
    // put the panel in a fixed, internally scrolling layer below the header.
    const scrollY = window.scrollY;
    const openedAt = window.location.pathname;
    const gutter = window.innerWidth - root.clientWidth;
    const saved = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      paddingRight: body.style.paddingRight,
    };
    const setTop = () => head && root.style.setProperty("--nav-top", `${Math.round(head.getBoundingClientRect().height)}px`);
    setTop();
    root.classList.add("nav-open");
    Object.assign(body.style, { position: "fixed", top: `-${scrollY}px`, left: "0", right: "0", width: "100%" });
    if (gutter > 0) body.style.paddingRight = `${gutter}px`;
    panel.current?.scrollTo?.({ top: 0 });
    panel.current?.querySelector<HTMLElement>("a")?.focus({ preventScroll: true });

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus({ preventScroll: true });
      }
    };
    // Back to the desktop layout (window resize, rotation): the phone menu has nothing to show.
    const wide = window.matchMedia("(min-width: 960px)");
    const onWide = () => wide.matches && setOpen(false);
    const resize = head ? new ResizeObserver(setTop) : null;
    if (head) resize?.observe(head);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", setTop);
    wide.addEventListener("change", onWide);
    onWide();
    return () => {
      root.classList.remove("nav-open");
      Object.assign(body.style, saved);
      // Same page: put the reader back where they were. New page: the router owns scroll.
      if (window.location.pathname === openedAt) window.scrollTo({ top: scrollY, left: 0, behavior: "instant" as ScrollBehavior });
      resize?.disconnect();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", setTop);
      wide.removeEventListener("change", onWide);
    };
  }, [open]);

  // t113: hide the header while reading down, show it on a small scroll up.
  // Passive + rAF-throttled; never while the menu is open (its scroll lock moves
  // scrollY) or while keyboard focus is inside the header.
  useEffect(() => {
    const root = document.documentElement;
    const head = header.current;
    if (!head) return;
    const UP = 8;
    let last: number | null = window.scrollY;
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = Math.max(0, window.scrollY);
      if (root.classList.contains("nav-open")) {
        last = null; // lock/unlock jumps are not reader scrolls
        head.classList.remove("is-hidden");
        return;
      }
      if (last === null) {
        last = y;
        return;
      }
      const near = y <= head.offsetHeight;
      if (near || head.contains(document.activeElement)) {
        head.classList.remove("is-hidden");
        last = y;
      } else if (y > last) {
        head.classList.add("is-hidden");
        last = y;
      } else if (last - y >= UP) {
        head.classList.remove("is-hidden");
        last = y;
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const onFocus = () => head.classList.remove("is-hidden");
    window.addEventListener("scroll", onScroll, { passive: true });
    head.addEventListener("focusin", onFocus);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      head.removeEventListener("focusin", onFocus);
      head.classList.remove("is-hidden");
    };
  }, []);

  useEffect(() => {
    if (open) header.current?.classList.remove("is-hidden");
  }, [open]);

  // Safety net: never leave a lock behind if the header unmounts mid-open.
  useEffect(() => () => document.documentElement.classList.remove("nav-open"), []);

  return (
    <header className="site-header" ref={header}>
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
