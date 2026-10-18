import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { adminSignOut } from "@/content/admin-api";

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
      { to: "/admin/ticker", label: "Top strip / Ticker" },
      { to: "/admin/site-text", label: "Site text" },
      { to: "/admin/appearance", label: "Appearance" },
    ],
  },
  {
    label: "Automation",
    links: [{ to: "/admin/automation", label: "AI automation" }],
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
}: {
  children: ReactNode;
  mode: "dev" | "account";
  email: string | null;
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Admin-only colour mode, saved in this browser. The public site is unaffected.
  const [theme, setTheme] = useState<"light" | "dark" | "system">("light");
  useEffect(() => {
    const saved = window.localStorage.getItem("dypol-admin-theme");
    if (saved === "light" || saved === "dark" || saved === "system") setTheme(saved);
  }, []);
  const chooseTheme = (next: "light" | "dark" | "system") => {
    setTheme(next);
    window.localStorage.setItem("dypol-admin-theme", next);
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
            <label className="adm-theme">
              <span>Admin colours</span>
              <select value={theme} onChange={(e) => chooseTheme(e.target.value as "light" | "dark" | "system")} data-testid="admin-theme">
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">Match my device</option>
              </select>
            </label>
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
