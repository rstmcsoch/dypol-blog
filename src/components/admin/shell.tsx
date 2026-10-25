import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import {
  Activity, BarChart3, Bell, Bot, ChevronRight, ExternalLink, FileText, HelpCircle, Image, Inbox, LayoutDashboard, LayoutTemplate,
  LogOut, Megaphone, Menu, Monitor, Moon, Palette, PanelLeft, ScrollText, Search, Settings, ShieldCheck, SlidersHorizontal, Sun, Tags,
  Type, X, type LucideIcon,
} from "lucide-react";
import { adminDashboard, adminMessages, adminSignOut } from "@/content/admin-api";

type NavLinkDef = { to: string; label: string; exact?: boolean; icon: LucideIcon };

const groups: { label: string; links: NavLinkDef[] }[] = [
  {
    label: "Content",
    links: [
      { to: "/admin", label: "Dashboard", exact: true, icon: LayoutDashboard },
      { to: "/admin/articles", label: "Articles", icon: FileText },
      { to: "/admin/topics", label: "Topics & tags", icon: Tags },
      { to: "/admin/media", label: "Media", icon: Image },
      { to: "/admin/messages", label: "Messages", icon: Inbox },
    ],
  },
  {
    label: "Analytics",
    links: [{ to: "/admin/stats", label: "Stats", icon: BarChart3 }],
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

const isActive = (link: NavLinkDef, pathname: string) =>
  link.exact ? pathname === link.to || pathname === `${link.to}/` : pathname === link.to || pathname.startsWith(`${link.to}/`);

/* t120: admin UI preferences, saved in this browser only (admin-only; the
   public site never reads them). "system" follows the device. */
type ThemePref = "light" | "dark" | "system";
type Prefs = { theme: ThemePref; sidebar: "full" | "mini"; cards: "shadow" | "border"; container: "full" | "boxed" };
const DEFAULT_PREFS: Prefs = { theme: "system", sidebar: "full", cards: "shadow", container: "full" };
const KEYS = { theme: "dypol-admin-theme", sidebar: "dypol-admin-sidebar", cards: "dypol-admin-cards", container: "dypol-admin-container" } as const;
const NOTIF_SEEN_KEY = "dypol-admin-notif-seen";

function readPrefs(): Prefs {
  const get = (k: string) => window.localStorage.getItem(k);
  const theme = get(KEYS.theme);
  return {
    theme: theme === "light" || theme === "dark" ? theme : "system",
    sidebar: get(KEYS.sidebar) === "mini" ? "mini" : "full",
    cards: get(KEYS.cards) === "border" ? "border" : "shadow",
    container: get(KEYS.container) === "boxed" ? "boxed" : "full",
  };
}

type Notif = {
  messages: { id: string; name: string; message: string; createdAt: string }[];
  drafts: number;
  scheduled: number;
  attention: { id: string; title: string; status: string }[];
};

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

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
  const [open, setOpen] = useState(false); // phone/tablet drawer
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [systemDark, setSystemDark] = useState(false);
  const [menu, setMenu] = useState<null | "notif" | "profile">(null);
  const [customizer, setCustomizer] = useState(false);
  const [notif, setNotif] = useState<Notif | null>(null);
  const [seenAt, setSeenAt] = useState(0);
  const [query, setQuery] = useState("");
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setPrefs(readPrefs());
    setSeenAt(Number(window.localStorage.getItem(NOTIF_SEEN_KEY) ?? 0) || 0);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setPref = <K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    setPrefs((p) => ({ ...p, [key]: value }));
    if (key === "theme" && value === "system") window.localStorage.removeItem(KEYS.theme);
    else window.localStorage.setItem(KEYS[key], String(value));
  };

  const theme: "light" | "dark" = prefs.theme === "system" ? (systemDark ? "dark" : "light") : prefs.theme;
  const toggleTheme = () => setPref("theme", theme === "dark" ? "light" : "dark");

  // Real notifications only: contact-form messages + drafts/scheduled counts.
  const loadNotif = useCallback(async () => {
    try {
      const [msgs, dash] = await Promise.all([adminMessages(), adminDashboard()]);
      setNotif({
        messages: msgs.messages.slice(0, 5).map((m) => ({ id: String(m.id), name: m.name, message: m.message, createdAt: m.createdAt })),
        drafts: dash.counts.draft,
        scheduled: dash.counts.scheduled,
        attention: dash.attention.slice(0, 3).map((a) => ({ id: a.id, title: a.title, status: a.status })),
      });
    } catch {
      setNotif({ messages: [], drafts: 0, scheduled: 0, attention: [] });
    }
  }, []);
  useEffect(() => {
    void loadNotif();
  }, [loadNotif]);
  const newMessages = notif ? notif.messages.filter((m) => new Date(m.createdAt).getTime() > seenAt).length : 0;

  // Close the drawer and menus on navigation; Esc closes any overlay.
  useEffect(() => {
    setOpen(false);
    setMenu(null);
  }, [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      setMenu(null);
      setCustomizer(false);
    };
    const onDown = (e: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, []);

  const onBurger = () => {
    if (window.matchMedia("(min-width: 960px)").matches) setPref("sidebar", prefs.sidebar === "mini" ? "full" : "mini");
    else setOpen((v) => !v);
  };

  const openNotif = () => {
    const next = menu === "notif" ? null : "notif";
    setMenu(next);
    if (next) {
      void loadNotif();
      const now = Date.now();
      window.localStorage.setItem(NOTIF_SEEN_KEY, String(now));
      // Keep the "new" dots visible while the panel is open; badge clears next time.
      window.setTimeout(() => setSeenAt(now), 0);
    }
  };

  const signOut = () => {
    void (async () => {
      await adminSignOut();
      await router.invalidate();
      await router.navigate({ to: "/admin", search: { denied: false } });
    })();
  };

  const current = groups.flatMap((g) => g.links.map((l) => ({ ...l, group: g.label }))).find((l) => isActive(l, pathname));
  const who = mode === "dev" ? "Local preview" : (email ?? "Signed in with admin token");
  const initial = (email ?? "A").trim().charAt(0).toUpperCase() || "A";

  const themeButton = (
    <button
      type="button"
      className="adm-theme-toggle adm-hbtn"
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
    <div
      className="desk"
      data-theme={theme}
      data-sidebar={prefs.sidebar}
      data-cards={prefs.cards}
      data-container={prefs.container}
      data-drawer={open ? "open" : "closed"}
    >
      <aside className={open ? "adm-side is-open" : "adm-side"} aria-label="Admin sidebar">
        <div className="adm-brand">
          <Link to="/admin" onClick={() => setOpen(false)} title="DYPOL Blog admin">
            <span className="adm-logo" aria-hidden="true">D</span>
            <span className="adm-brand__text">
              DYPOL Blog
              <small>Admin</small>
            </span>
          </Link>
          <button type="button" className="adm-menu-btn adm-hbtn" aria-label="Close menu" onClick={() => setOpen(false)}>
            <X aria-hidden="true" size={20} />
          </button>
        </div>
        <nav id="adm-nav" className="adm-nav" aria-label="Admin">
          {groups.map((group) => (
            <div className="adm-group" key={group.label}>
              <p className="adm-group__label">
                <span>{group.label}</span>
              </p>
              {group.links.map((link) => {
                const active = isActive(link, pathname);
                const Icon = link.icon;
                return (
                  <Link
                    key={link.to}
                    to={link.to}
                    className={active ? "adm-nav__item is-active" : "adm-nav__item"}
                    aria-current={active ? "page" : undefined}
                    title={link.label}
                    onClick={() => setOpen(false)}
                  >
                    <Icon aria-hidden="true" size={19} className="adm-nav__icon" />
                    <span className="adm-nav__text">{link.label}</span>
                    {link.to === "/admin/messages" && newMessages > 0 ? <span className="adm-nav__badge">{newMessages}</span> : null}
                  </Link>
                );
              })}
            </div>
          ))}
          <div className="adm-group adm-group--foot">
            <a href="/" target="_blank" rel="noreferrer" className="adm-nav__item" title="View site">
              <ExternalLink aria-hidden="true" size={19} className="adm-nav__icon" />
              <span className="adm-nav__text">View site</span>
            </a>
            <button type="button" className="adm-nav__item" title="Sign out" onClick={signOut}>
              <LogOut aria-hidden="true" size={19} className="adm-nav__icon" />
              <span className="adm-nav__text">Sign out</span>
            </button>
            <p className="adm-who">{who}</p>
          </div>
        </nav>
      </aside>
      <div className="adm-overlay" aria-hidden="true" onClick={() => setOpen(false)} />
      <main className="desk-main">
        <header className="adm-topbar" ref={headerRef}>
          <button
            type="button"
            className="adm-burger adm-hbtn"
            aria-label="Toggle sidebar"
            aria-expanded={open}
            aria-controls="adm-nav"
            onClick={onBurger}
          >
            <PanelLeft aria-hidden="true" size={20} className="adm-burger__desk" />
            <Menu aria-hidden="true" size={20} className="adm-burger__phone" />
          </button>
          <form
            className="adm-search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              const q = query.trim();
              void router.navigate({ to: "/admin/articles", search: q ? { q } : {} });
            }}
          >
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search articles…"
              aria-label="Search articles"
            />
            <button type="submit" aria-label="Search">
              <Search aria-hidden="true" size={17} />
            </button>
          </form>
          <div className="adm-topbar__right">
            <a className="adm-hbtn adm-hide-sm" href="/" target="_blank" rel="noreferrer" aria-label="View site" title="View site">
              <ExternalLink aria-hidden="true" size={19} />
            </a>
            {themeButton}
            <div className="adm-dd">
              <button
                type="button"
                className="adm-hbtn"
                aria-label={newMessages > 0 ? `Notifications, ${newMessages} new` : "Notifications"}
                aria-expanded={menu === "notif"}
                aria-haspopup="true"
                onClick={openNotif}
                data-testid="admin-notifications"
              >
                <Bell aria-hidden="true" size={19} />
                {newMessages > 0 ? <span className="adm-hbtn__badge">{newMessages}</span> : null}
              </button>
              {menu === "notif" ? (
                <div className="adm-dd__panel adm-dd__panel--notif" role="dialog" aria-label="Notifications">
                  <div className="adm-dd__head">
                    <strong>Notifications</strong>
                    {newMessages > 0 ? <span className="adm-pill">{newMessages} new</span> : null}
                  </div>
                  {!notif ? (
                    <p className="adm-dd__empty">Loading…</p>
                  ) : (
                    <ul className="adm-dd__list">
                      {notif.messages.map((m) => (
                        <li key={m.id}>
                          <Link to="/admin/messages" className="adm-dd__item" onClick={() => setMenu(null)}>
                            <span className="adm-chipicon adm-chipicon--primary"><Inbox aria-hidden="true" size={18} /></span>
                            <span className="adm-dd__body">
                              <strong>{m.name}{new Date(m.createdAt).getTime() > seenAt ? <i className="adm-dot" aria-label="new" /> : null}</strong>
                              <small>{m.message}</small>
                            </span>
                            <time className="adm-dd__time">{timeAgo(m.createdAt)}</time>
                          </Link>
                        </li>
                      ))}
                      {notif.drafts > 0 ? (
                        <li>
                          <Link to="/admin/articles" search={{ status: "draft" }} className="adm-dd__item" onClick={() => setMenu(null)}>
                            <span className="adm-chipicon adm-chipicon--warn"><FileText aria-hidden="true" size={18} /></span>
                            <span className="adm-dd__body">
                              <strong>{notif.drafts} draft{notif.drafts === 1 ? "" : "s"}</strong>
                              <small>Waiting to be reviewed or published</small>
                            </span>
                          </Link>
                        </li>
                      ) : null}
                      {notif.scheduled > 0 ? (
                        <li>
                          <Link to="/admin/articles" className="adm-dd__item" onClick={() => setMenu(null)}>
                            <span className="adm-chipicon adm-chipicon--info"><FileText aria-hidden="true" size={18} /></span>
                            <span className="adm-dd__body">
                              <strong>{notif.scheduled} scheduled</strong>
                              <small>Articles set to publish later</small>
                            </span>
                          </Link>
                        </li>
                      ) : null}
                      {notif.attention.map((a) => (
                        <li key={a.id}>
                          <Link to="/admin/articles/$id" params={{ id: a.id }} className="adm-dd__item" onClick={() => setMenu(null)}>
                            <span className="adm-chipicon adm-chipicon--muted"><FileText aria-hidden="true" size={18} /></span>
                            <span className="adm-dd__body">
                              <strong>{a.title}</strong>
                              <small>Needs attention · {a.status}</small>
                            </span>
                          </Link>
                        </li>
                      ))}
                      {notif.messages.length === 0 && notif.drafts === 0 && notif.scheduled === 0 && notif.attention.length === 0 ? (
                        <li className="adm-dd__empty">You're all caught up.</li>
                      ) : null}
                    </ul>
                  )}
                  <Link to="/admin/messages" className="adm-btn adm-dd__all" onClick={() => setMenu(null)}>
                    See all messages
                  </Link>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="adm-hbtn"
              aria-label="Admin display settings"
              title="Display settings"
              aria-expanded={customizer}
              onClick={() => {
                setMenu(null);
                setCustomizer(true);
              }}
              data-testid="admin-customizer"
            >
              <SlidersHorizontal aria-hidden="true" size={19} />
            </button>
            <div className="adm-dd">
              <button
                type="button"
                className="adm-avatar"
                aria-label="Account menu"
                aria-expanded={menu === "profile"}
                aria-haspopup="true"
                onClick={() => setMenu(menu === "profile" ? null : "profile")}
              >
                {initial}
              </button>
              {menu === "profile" ? (
                <div className="adm-dd__panel adm-dd__panel--profile" role="menu" aria-label="Account">
                  <div className="adm-profile">
                    <span className="adm-avatar adm-avatar--lg" aria-hidden="true">{initial}</span>
                    <strong>{mode === "dev" ? "Local preview" : "Admin"}</strong>
                    <small>{who}</small>
                  </div>
                  <Link to="/admin/settings" className="adm-dd__link" role="menuitem" onClick={() => setMenu(null)}>
                    <Settings aria-hidden="true" size={17} /> Settings
                  </Link>
                  <Link to="/admin/security" className="adm-dd__link" role="menuitem" onClick={() => setMenu(null)}>
                    <ShieldCheck aria-hidden="true" size={17} /> Security
                  </Link>
                  <a href="/" target="_blank" rel="noreferrer" className="adm-dd__link" role="menuitem">
                    <ExternalLink aria-hidden="true" size={17} /> View site
                  </a>
                  <button type="button" className="adm-btn adm-dd__all" role="menuitem" onClick={signOut}>
                    <LogOut aria-hidden="true" size={16} /> Log out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <div className="adm-content">
          {current ? (
            <nav className="adm-crumbs" aria-label="Breadcrumb">
              <Link to="/admin">Home</Link>
              <ChevronRight aria-hidden="true" size={14} />
              <span>{current.group}</span>
              <ChevronRight aria-hidden="true" size={14} />
              <span className="adm-crumbs__here" aria-current="page">{current.label}</span>
            </nav>
          ) : null}
          {children}
        </div>
      </main>
      {customizer ? (
        <>
          <div className="adm-overlay adm-overlay--on" aria-hidden="true" onClick={() => setCustomizer(false)} />
          <aside className="adm-customizer" role="dialog" aria-modal="true" aria-label="Display settings">
            <div className="adm-customizer__head">
              <strong>Display settings</strong>
              <button type="button" className="adm-hbtn" aria-label="Close settings" onClick={() => setCustomizer(false)} autoFocus>
                <X aria-hidden="true" size={20} />
              </button>
            </div>
            <p className="adm-customizer__note">Saved in this browser. Only the admin panel changes; the public site is untouched.</p>
            <Choice
              title="Theme"
              value={prefs.theme}
              onChange={(v) => setPref("theme", v)}
              options={[
                { value: "light", label: "Light", icon: Sun },
                { value: "dark", label: "Dark", icon: Moon },
                { value: "system", label: "System", icon: Monitor },
              ]}
            />
            <Choice
              title="Sidebar (desktop)"
              value={prefs.sidebar}
              onChange={(v) => setPref("sidebar", v)}
              options={[
                { value: "full", label: "Full", icon: PanelLeft },
                { value: "mini", label: "Mini", icon: Menu },
              ]}
            />
            <Choice
              title="Cards"
              value={prefs.cards}
              onChange={(v) => setPref("cards", v)}
              options={[
                { value: "shadow", label: "Shadow" },
                { value: "border", label: "Border" },
              ]}
            />
            <Choice
              title="Container"
              value={prefs.container}
              onChange={(v) => setPref("container", v)}
              options={[
                { value: "full", label: "Full" },
                { value: "boxed", label: "Boxed" },
              ]}
            />
          </aside>
        </>
      ) : null}
    </div>
  );
}

function Choice<T extends string>({
  title,
  value,
  onChange,
  options,
}: {
  title: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: LucideIcon }[];
}) {
  return (
    <fieldset className="adm-choice">
      <legend>{title}</legend>
      <div className="adm-choice__row">
        {options.map((o) => {
          const Icon = o.icon;
          return (
            <button
              key={o.value}
              type="button"
              className={value === o.value ? "adm-choice__btn is-on" : "adm-choice__btn"}
              aria-pressed={value === o.value}
              onClick={() => onChange(o.value)}
            >
              {Icon ? <Icon aria-hidden="true" size={17} /> : null}
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
