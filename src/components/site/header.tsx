import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { site } from "@/content/site";
import { NavLink } from "./nav-link";
import { ThemeToggle } from "./theme-toggle";

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="site-header">
      <div className="container bar">
        <NavLink href="/" className="wordmark">
          <span className="wordmark__name">DYPOL</span>
          <span className="wordmark__stamp">
            <span className="grain-layer" aria-hidden="true" />
            <span>Blog</span>
          </span>
        </NavLink>
        <nav
          id="site-nav"
          className={open ? "site-nav is-open" : "site-nav"}
          aria-label={site.labels.primaryNav}
        >
          <div className="site-nav__inner">
            {site.nav.map((item) => (
              <NavLink key={item.id} href={item.href} className="nav-link">
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>
        <div className="bar-tools">
          <ThemeToggle />
          <button
            type="button"
            className="menu-btn"
            aria-expanded={open}
            aria-controls="site-nav"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? site.labels.close : site.labels.menu}
          </button>
        </div>
      </div>
    </header>
  );
}
