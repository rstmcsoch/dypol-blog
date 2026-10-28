/**
 * Social links for the footer (t65). Fixed platform set, stored in
 * site settings as an ordered list; the footer renders only platforms
 * with a URL set and toggled on — icons only, no text labels.
 */

export const SOCIAL_PLATFORMS = ["x", "facebook", "instagram", "youtube", "linkedin", "rss", "email"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export type SocialLink = { platform: SocialPlatform; url: string; visible: boolean };

export const SOCIAL_LABELS: Record<SocialPlatform, string> = {
  x: "X (Twitter)",
  facebook: "Facebook",
  instagram: "Instagram",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  rss: "RSS feed",
  email: "Email",
};

/** https only, except mailto: for email and a site path (e.g. /feed.xml) for RSS. */
export function validSocialUrl(platform: SocialPlatform, url: string): boolean {
  const value = url.trim();
  if (!value) return true;
  if (value.length > 500) return false;
  if (platform === "email") return /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (platform === "rss" && value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname.includes(".");
  } catch {
    return false;
  }
}

/**
 * Canonicalise stored socials: canonical platform order, one entry per
 * platform, invalid URLs dropped to empty (hidden), unknown platforms
 * removed. Invalid entries never reach the footer.
 */
export function normalizeSocials(input: unknown): SocialLink[] {
  if (!Array.isArray(input)) return [];
  const byPlatform = new Map<SocialPlatform, SocialLink>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as { platform?: unknown; url?: unknown; visible?: unknown };
    if (!SOCIAL_PLATFORMS.includes(entry.platform as SocialPlatform)) continue;
    const platform = entry.platform as SocialPlatform;
    const url = typeof entry.url === "string" ? entry.url.trim() : "";
    byPlatform.set(platform, {
      platform,
      url: validSocialUrl(platform, url) ? url : "",
      visible: entry.visible !== false,
    });
  }
  return SOCIAL_PLATFORMS.filter((p) => byPlatform.has(p)).map((p) => byPlatform.get(p) as SocialLink);
}

/** What the footer actually renders: URL set + toggled on. */
export function isRootSocialUrl(platform: SocialPlatform, value: string): boolean {
  if (platform === "rss" || platform === "email" || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.pathname.replaceAll("/", "") === "" && !url.search && !url.hash;
  } catch { return false; }
}

export function visibleSocials(socials: SocialLink[] | undefined): SocialLink[] {
  return normalizeSocials(socials).filter((s) => s.visible && s.url.length > 0 && !isRootSocialUrl(s.platform, s.url));
}

export type FooterColumn = { heading: string; links: { label: string; href: string; newTab?: boolean }[] };

/**
 * Footer columns from OUR pages only (t65). Page links are gated on
 * the published pages list, so a hidden/removed page never leaves a
 * dead footer link. About appears once (in Explore).
 */
export function footerColumns(pages: { slug: string; title: string }[]): FooterColumn[] {
  const has = (slug: string) => pages.some((p) => p.slug === slug);
  const page = (slug: string, label: string) => ({ label, href: `/${slug}` });
  const columns: FooterColumn[] = [
    {
      heading: "Explore",
      links: [
        { label: "Home", href: "/" },
        { label: "Index", href: "/articles" },
        { label: "Topics", href: "/topics" },
        ...(has("about") ? [page("about", "About Us")] : []),
      ],
    },
    {
      heading: "Company",
      links: [
        ...(has("contact") ? [page("contact", "Contact")] : []),
        ...(has("editorial-policy") ? [page("editorial-policy", "Editorial Policy")] : []),
        ...(has("corrections-policy") ? [page("corrections-policy", "Corrections Policy")] : []),
      ],
    },
    {
      heading: "Legal",
      links: [
        ...(has("privacy-policy") ? [page("privacy-policy", "Privacy Policy")] : []),
        ...(has("terms") ? [page("terms", "Terms and Conditions")] : []),
        ...(has("dmca") ? [page("dmca", "DMCA / Copyright Policy")] : []),
        ...(has("cookie-policy") ? [page("cookie-policy", "Cookie Policy")] : []),
        ...(has("disclaimer") ? [page("disclaimer", "Disclaimer")] : []),
      ],
    },
  ];
  return columns.filter((c) => c.links.length > 0);
}
