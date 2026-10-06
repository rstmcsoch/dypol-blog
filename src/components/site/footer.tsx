import { NavLink } from "./nav-link";
import { useSite } from "./use-site";

export function SiteFooter() {
  const site = useSite();
  const links = site.nav.filter((item) => item.visible);
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div className="footer-brand">
          <p className="footer-mark">DYPOL</p>
          <p className="footer-note">{site.description}</p>
        </div>
        <nav className="footer-nav" aria-label={site.labels.footerNav}>
          {links.map((item) => (
            <NavLink key={item.id} href={item.href} className="footer-link">
              {item.label}
            </NavLink>
          ))}
          {site.footer.links.map((item) => (
            <a key={item.id} href={item.href} className="footer-link">
              {item.label}
            </a>
          ))}
        </nav>
        <p className="footer-sign">{site.footer.note}</p>
      </div>
    </footer>
  );
}
