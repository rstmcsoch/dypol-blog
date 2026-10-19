import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { Activity, Bot, ShieldCheck, FileText, HelpCircle, Image, ScrollText, LayoutDashboard, LayoutTemplate, LogOut, Megaphone, Moon, Palette, Settings, Sun, Tags, Type, ExternalLink, type LucideIcon } from "lucide-react";
import { adminSignOut } from "@/content/admin-api";

type NavLinkDef = { to: string; label: string; exact?: boolean; icon: LucideIcon };

const groups: { label: string; links: NavLinkDef[] }[] = [
  {
    label: "Content",
    links: [
      { to: "/admin", label: "Dashboard", exact: true, icon: LayoutDashboard },
      { to: "/admin/articles", label: "Articles", icon: FileText },
      { to: "/admin/topics", label: "Topics & tags", icon: Tags },
      { to: "/admin/media", label: "Media", icon: Image },
    ],
  },
  {
    label: "Site",
    links: [
      { to: "/admin/homepage", label: "Homepage builder", icon: LayoutTemplate },
      { to: "/admin/ticker", label: "Top strip / Ticker", icon: Megaphone },
      { to: "/admin/site-text", label: "Site text", icon: Type },
      { to: "/admin/pages", label: "Pages", icon: ScrollText },
      { to: "/admin/appearance", label: "Appearance", icon: Palette },
    ],
  },
  {
    label: "Automation",
    links: [{ to: "/admin/automation", label: "AI automation", icon: Bot }],
  },
  {
    label: "System",
    links: [
      { to: "/admin/settings", label: "Settings", icon: Settings },
      { to: "/admin/security", label: "Security", icon: ShieldCheck },
      { to: "/admin/health", label: "Site health", icon: Activity },
      { to: "/admin/help", label: "Help", icon: HelpCircle },
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
  // Admin-only binary colour mode, saved in this browser. First visit follows
  // the device; after that the toggle choice wins. Public site is unaffected.
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const saved = window.localStorage.getItem("dypol-admin-theme");
    if (saved === "light" || saved === "dark") setTheme(saved);
    else if (window.matchMedia("(prefers-color-scheme: dark)").matches) setTheme("dark");
  }, []);
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    window.localStorage.setItem("dypol-admin-theme", next);
  };
  const themeButton = (
    <button
      type="button"
      className="adm-theme-toggle"
      onClick={toggleTheme}
      aria-label={theme === "dark" ? "Switch admin to light mode" : "Switch admin to dark mode"}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={theme === "dark"}
      data-testid="admin-theme-toggle"
      data-theme-value={theme}
    >
      {theme === "dark" ? <Sun aria-hidden="true" size={19} /> : <Moon aria-hidden="true" size={19} />}
    </button>
  );
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
          <span className="adm-brand__actions">
            <button type="button" className="adm-menu-btn" aria-expanded={open} aria-controls="adm-nav" onClick={() => setOpen((v) => !v)}>
              {open ? "Close" : "Menu"}
            </button>
          </span>
        </div>
        <nav id="adm-nav" className="adm-nav" aria-label="Admin">
          {groups.map((group) => (
            <div className="adm-group" key={group.label}>
              <p className="adm-group__label">{group.label}</p>
              {group.links.map((link) => {
                const active = link.exact ? pathname === link.to || pathname === `${link.to}/` : pathname === link.to || pathname.startsWith(`${link.to}/`);
                const Icon = link.icon;
                return (
                  <Link
                    key={link.to}
                    to={link.to}
                    className={active ? "adm-nav__item is-active" : "adm-nav__item"}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpen(false)}
                  >
                    <Icon aria-hidden="true" size={18} className="adm-nav__icon" />
                    <span>{link.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
          <div className="adm-group adm-group--foot">
            <a href="/" target="_blank" rel="noreferrer" className="adm-nav__item">
              <ExternalLink aria-hidden="true" size={18} className="adm-nav__icon" />
              <span>View site</span>
            </a>
            <button
              type="button"
              className="adm-nav__item"
              onClick={() => {
                void (async () => {
                  await adminSignOut();
                  await router.invalidate();
                  await router.navigate({ to: "/admin", search: { denied: false } });
                })();
              }}
            >
              <LogOut aria-hidden="true" size={18} className="adm-nav__icon" />
              <span>Sign out</span>
            </button>
            <p className="adm-who">{mode === "dev" ? "Local preview" : (email ?? "Signed in with admin token")}</p>
          </div>
        </nav>
      </aside>
      <main className="desk-main">
        <div className="adm-topbar">{themeButton}</div>
        <div className="adm-content">{children}</div>
      </main>
    </div>
  );
}
