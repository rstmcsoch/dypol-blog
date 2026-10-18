import { NavLink } from "./nav-link";
import { usePages, useSite } from "./use-site";

export function SiteFooter() {
  const site = useSite();
  const links = site.nav.filter((item) => item.visible);
  const pages = usePages();
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
          {pages
            .filter((page) => !(page.slug === "about" && links.some((item) => item.href === "/about")))
            .map((page) => (
              <a key={page.slug} href={`/${page.slug}`} className="footer-link">
                {page.title}
              </a>
            ))}
        </nav>
        <p className="footer-sign">{site.footer.note}</p>
      </div>
    </footer>
  );
}
