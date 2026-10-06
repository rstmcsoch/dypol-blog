import { useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";

const links = [
  { to: "/admin", label: "Desk", exact: true },
  { to: "/admin/articles", label: "Pieces" },
  { to: "/admin/topics", label: "Topics" },
  { to: "/admin/media", label: "Media" },
  { to: "/admin/settings", label: "Settings" },
] as const;

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
  const [open, setOpen] = useState(false);
  return (
    <div className="desk">
      <header className="desk-bar">
        <div className="container desk-bar-inner">
          <Link to="/admin" className="desk-brand">
            DYPOL <span>Desk</span>
          </Link>
          <nav className={open ? "desk-nav is-open" : "desk-nav"} aria-label="Desk">
            {links.map((link) => {
              const active =
                "exact" in link && link.exact
                  ? pathname === link.to
                  : pathname === link.to || pathname.startsWith(`${link.to}/`);
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
            <Link to="/" onClick={() => setOpen(false)}>
              View journal
            </Link>
          </nav>
          <p className="desk-mode">{mode === "dev" ? "Preview desk" : (email ?? "Editor")}</p>
          <button type="button" className="desk-nav-btn" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            {open ? "Close" : "Sections"}
          </button>
        </div>
      </header>
      <div className="desk-main">
        <div className="container">{children}</div>
      </div>
    </div>
  );
}
