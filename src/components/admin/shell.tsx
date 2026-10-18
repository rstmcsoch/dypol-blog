import { useState, type ReactNode } from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { adminSetDeskTheme, adminSignOut } from "@/content/admin-api";
import { DESK_THEME_LABELS, deskThemes, type DeskTheme } from "@/lib/admin-theme";

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
  const [themeError, setThemeError] = useState<string | null>(null);
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
        <div className="adm-topbar">
          <div className="desk-theme" role="group" aria-label="Desk appearance">
            {deskThemes.map((choice) => (
              <button key={choice} type="button" aria-pressed={theme === choice} onClick={() => chooseTheme(choice)}>
                {DESK_THEME_LABELS[choice]}
              </button>
            ))}
          </div>
          {themeError ? (
            <p className="desk-note" role="alert">
              {themeError}
            </p>
          ) : null}
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
        <div className="adm-content">{children}</div>
      </main>
    </div>
  );
}
