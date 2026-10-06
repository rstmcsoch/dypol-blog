import { site } from "@/content/site";
import { NavLink } from "./nav-link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div className="footer-brand">
          <p className="footer-mark">DYPOL</p>
          <p className="footer-note">{site.description}</p>
        </div>
        <nav className="footer-nav" aria-label={site.labels.footerNav}>
          {site.nav.map((item) => (
            <NavLink key={item.id} href={item.href} className="footer-link">
              {item.label}
            </NavLink>
          ))}
        </nav>
        <p className="footer-sign">{site.footer.note}</p>
      </div>
    </footer>
  );
}
