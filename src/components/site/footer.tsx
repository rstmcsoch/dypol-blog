import { footerColumns, visibleSocials, SOCIAL_LABELS, type SocialPlatform } from "@/lib/social-links";
import { usePages, useSite } from "./use-site";

/** Inline brand icons (no icon library). Fill paths are the platforms'
 * standard glyphs; instagram/rss/email are drawn strokes. */
function SocialIcon({ platform }: { platform: SocialPlatform }) {
  const common = {
    width: 19,
    height: 19,
    viewBox: "0 0 24 24",
    "aria-hidden": true as const,
    focusable: false as const,
  };
  switch (platform) {
    case "x":
      return (
        <svg {...common} fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.451-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644Z" />
        </svg>
      );
    case "facebook":
      return (
        <svg {...common} fill="currentColor">
          <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047v-2.66c0-3.025 1.792-4.697 4.533-4.697 1.313 0 2.686.236 2.686.236v2.971H15.83c-1.491 0-1.956.93-1.956 1.886v2.264h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073Z" />
        </svg>
      );
    case "youtube":
      return (
        <svg {...common} fill="currentColor">
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814ZM9.545 15.568V8.432L15.818 12l-6.273 3.568Z" />
        </svg>
      );
    case "linkedin":
      return (
        <svg {...common} fill="currentColor">
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286ZM5.337 7.433a2.062 2.062 0 1 1 0-4.124 2.062 2.062 0 0 1 0 4.124ZM7.119 20.452H3.555V9h3.564v11.452Z" />
        </svg>
      );
    case "instagram":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case "rss":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M4 10a10 10 0 0 1 10 10" />
          <path d="M4 4a16 16 0 0 1 16 16" />
          <circle cx="5" cy="19" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case "email":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m4 7 8 6 8-6" />
        </svg>
      );
  }
}

export function SiteFooter() {
  const site = useSite();
  const pages = usePages();
  const columns = footerColumns(pages);
  const socials = visibleSocials(site.socials);
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div className="footer-brand">
          <p className="footer-mark">DYPOL</p>
          <p className="footer-note">{site.description}</p>
          {socials.length > 0 ? (
            <div className="footer-socials">
              {socials.map((social) => (
                <a
                  key={social.platform}
                  className="footer-social"
                  href={social.url}
                  aria-label={SOCIAL_LABELS[social.platform]}
                  {...(social.url.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                >
                  <SocialIcon platform={social.platform} />
                </a>
              ))}
            </div>
          ) : null}
        </div>
        <div className="footer-columns">
          {columns.map((column) => (
            <nav key={column.heading} className="footer-col" aria-label={column.heading}>
              <p className="footer-col-title">{column.heading}</p>
              {column.links.map((link) => (
                <a key={link.href} href={link.href} className="footer-link">
                  {link.label}
                </a>
              ))}
            </nav>
          ))}
        </div>
        <p className="footer-sign">{site.footer.note}</p>
      </div>
    </footer>
  );
}
