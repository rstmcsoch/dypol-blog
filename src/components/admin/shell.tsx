import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { Monitor, Moon, Sun } from "lucide-react";
import { adminSetDeskTheme, adminSignOut } from "@/content/admin-api";
import type { DeskTheme } from "@/lib/admin-theme";

type NavLinkDef = { to: string; label: string; exact?: boolean };

const groups: { label: string; links: NavLinkDef[] }[] = [
  {
    label: "Content",
    links: [
      { to: "/admin", label: "Dashboard", exact: true },
      { to: "/admin/articles", label: "Articles" },
      { to: "/admin/topics", label: "Topics & tags" },
      { to: "/admin/media", label: "Media" },
    ],
  },
  {
    label: "Site",
    links: [
      { to: "/admin/homepage", label: "Homepage builder" },
      { to: "/admin/sidebar", label: "Sidebar manager" },
      { to: "/admin/ticker", label: "Trending ticker" },
      { to: "/admin/site-text", label: "Site text" },
      { to: "/admin/appearance", label: "Appearance" },
    ],
  },
  {
    label: "Automation",
    links: [
      { to: "/admin/automation", label: "Automations", exact: true },
      { to: "/admin/automation/history", label: "History & diagnostics" },
    ],
  },
  {
    label: "System",
    links: [
      { to: "/admin/settings", label: "Settings" },
      { to: "/admin/help", label: "Help" },
    ],
  },
];

export function AdminShell({
  children,
  mode,
  email,
  theme: storedTheme,
}: {
  children: ReactNode;
  mode: "dev" | "account";
  email: string | null;
  theme: DeskTheme;
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // The server already picked this from the cookie, so the desk never flashes
  // the wrong palette; changing it writes the cookie and updates in place.
  const [theme, setTheme] = useState<DeskTheme>(storedTheme);
  const [systemDark, setSystemDark] = useState(false);
  const [themeError, setThemeError] = useState<string | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  const darkActive = theme === "dark" || (theme === "system" && systemDark);
  const chooseTheme = (next: DeskTheme) => {
    const previous = theme;
    setTheme(next);
    setThemeError(null);
    void adminSetDeskTheme({ data: { theme: next } }).catch(() => {
      setTheme(previous);
      setThemeError("Could not save the desk appearance.");
    });
  };
  return (
    <div className="desk" data-theme={theme}>
      <aside className={open ? "adm-side is-open" : "adm-side"}>
        <div className="adm-brand">
          <Link to="/admin" onClick={() => setOpen(false)}>
            <span className="adm-logo" aria-hidden="true">D</span>
            <span>
              DYPOL Blog
              <small>Admin</small>
            </span>
          </Link>
          <button type="button" className="adm-menu-btn" aria-expanded={open} aria-controls="adm-nav" onClick={() => setOpen((v) => !v)}>
            {open ? "Close" : "Menu"}
          </button>
        </div>
        <nav id="adm-nav" className="adm-nav" aria-label="Admin">
          {groups.map((group) => (
            <div className="adm-group" key={group.label}>
              <p className="adm-group__label">{group.label}</p>
              {group.links.map((link) => {
                const active = link.exact ? pathname === link.to || pathname === `${link.to}/` : pathname === link.to || pathname.startsWith(`${link.to}/`);
                return (
                  <Link
                    key={link.to}
                    to={link.to}
                    className={active ? "is-active" : undefined}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpen(false)}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </div>
          ))}
          <div className="adm-group adm-group--foot">
            <a href="/" target="_blank" rel="noreferrer">
              View site ↗
            </a>
            <button
              type="button"
              onClick={() => {
                void adminSignOut().then(() => router.navigate({ to: "/login", search: { denied: false } }));
              }}
            >
              Sign out
            </button>
            <p className="adm-who">{mode === "dev" ? "Local preview" : (email ?? "Signed in with admin token")}</p>
          </div>
        </nav>
      </aside>
      <main className="desk-main">
        <header className="adm-topbar">
          {themeError ? <p className="desk-note" role="alert">{themeError}</p> : null}
          <div className="desk-theme-controls" role="group" aria-label="Admin appearance">
            <button
              type="button"
              className="desk-theme-toggle"
              aria-pressed={darkActive}
              aria-label={darkActive ? "Dark appearance active. Switch to light mode." : "Light appearance active. Switch to dark mode."}
              title={darkActive ? "Switch to light mode" : "Switch to dark mode"}
              onClick={() => chooseTheme(darkActive ? "light" : "dark")}
            >
              {darkActive ? <Moon aria-hidden="true" size={18} /> : <Sun aria-hidden="true" size={18} />}
              <span className="sr-only">{darkActive ? "Dark mode" : "Light mode"}</span>
            </button>
            <details className="desk-theme-options">
              <summary aria-label="More appearance options" title="More appearance options">
                <Monitor aria-hidden="true" size={16} />
              </summary>
              <div className="desk-theme-options__menu">
                <p>Theme preference</p>
                <button type="button" aria-pressed={theme === "system"} onClick={() => chooseTheme("system")}>
                  Use device setting {theme === "system" ? "· active" : ""}
                </button>
              </div>
            </details>
          </div>
        </header>
        <div className="adm-content">{children}</div>
      </main>
    </div>
  );
}
