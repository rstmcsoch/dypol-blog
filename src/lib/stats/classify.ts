/**
 * Coarse, privacy-preserving classification. Callers must not persist the raw
 * user agent, full referrer URL, or IP. Only the enums and a referrer host
 * (no path, no query) are stored.
 */

export const CHANNELS = ["organic", "direct", "referral", "social", "campaign", "internal", "other"] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABEL: Record<Channel, string> = {
  organic: "Organic search",
  direct: "No referrer",
  referral: "Referral sites",
  social: "Social",
  campaign: "Campaigns",
  internal: "Internal",
  other: "Other",
};

export const DEVICES = ["mobile", "desktop", "tablet", "unknown"] as const;
export type Device = (typeof DEVICES)[number];

export const BROWSERS = ["chrome", "safari", "firefox", "edge", "samsung", "other"] as const;
export type BrowserName = (typeof BROWSERS)[number];

export const SYSTEMS = ["windows", "macos", "ios", "android", "linux", "chromeos", "other"] as const;
export type OsName = (typeof SYSTEMS)[number];

const SEARCH_HOST = [
  /(^|\.)google\./,
  /(^|\.)bing\.com$/,
  /(^|\.)duckduckgo\.com$/,
  /(^|\.)yahoo\.(com|co\.[a-z]{2})$/,
  /(^|\.)baidu\.com$/,
  /(^|\.)ecosia\.org$/,
  /(^|\.)yandex\./,
  /^search\.brave\.com$/,
  /(^|\.)startpage\.com$/,
];

const SOCIAL_HOST = [
  /(^|\.)twitter\.com$/,
  /(^|\.)x\.com$/,
  /^t\.co$/,
  /(^|\.)facebook\.com$/,
  /(^|\.)fb\.com$/,
  /(^|\.)instagram\.com$/,
  /(^|\.)linkedin\.com$/,
  /(^|\.)reddit\.com$/,
  /^news\.ycombinator\.com$/,
  /(^|\.)youtube\.com$/,
  /(^|\.)tiktok\.com$/,
  /(^|\.)threads\.net$/,
  /(^|\.)bsky\.app$/,
  /(^|\.)whatsapp\.com$/,
  /^t\.me$/,
  /(^|\.)telegram\.org$/,
  /(^|\.)pinterest\.com$/,
];

export function cleanToken(value: unknown, max = 40): string {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._~-]/g, "")
    .slice(0, max);
}

/** Hostname only. Rejects IPs, localhost, paths and empty values. Strips a leading www. */
export function cleanHost(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let h = value.trim().toLowerCase();
  if (!h) return null;
  h = h.replace(/^https?:\/\//, "").split("/")[0]?.split("?")[0] ?? "";
  h = h.replace(/:\d+$/, "");
  if (h.startsWith("www.")) h = h.slice(4);
  if (!h || h.length > 80) return null;
  if (!/^[a-z0-9.-]+$/.test(h)) return null;
  if (h === "localhost" || h.endsWith(".local")) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return null;
  if (!h.includes(".")) return null;
  return h;
}

export function cleanCountry(value: unknown): string {
  if (typeof value !== "string") return "XX";
  const v = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(v) ? v : "XX";
}

export function cleanRegion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().replace(/\s+/g, " ").slice(0, 48);
  if (v.length < 2) return null;
  if (!/^[\p{L}\p{N} .'-]+$/u.test(v)) return null;
  return v;
}

export function countryLabel(code: string): string {
  if (code === "XX") return "Unknown";
  if (code === "T1") return "Anonymized network";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export type Acquisition = {
  channel: Channel;
  host: string | null;
  campaign: { source: string; medium: string; campaign: string } | null;
};

/**
 * Attribution used by this first-party meter (not GA4's model):
 * - Any valid UTM parameter => campaign, even if a referrer is also present.
 * - Empty referrer and no UTM => "direct", displayed as "No referrer".
 *   That is not proof the visitor typed the URL.
 * - Same site host => internal.
 * - Known search / social hosts, else referral.
 */
export function classifyAcquisition(input: {
  refHost: unknown;
  selfHost: string;
  utmSource: unknown;
  utmMedium: unknown;
  utmCampaign: unknown;
}): Acquisition {
  const source = cleanToken(input.utmSource);
  const medium = cleanToken(input.utmMedium);
  const campaign = cleanToken(input.utmCampaign);
  const host = cleanHost(input.refHost);
  const self = cleanHost(input.selfHost) ?? input.selfHost.trim().toLowerCase().replace(/^www\./, "");
  if (source || medium || campaign) {
    return {
      channel: "campaign",
      host,
      campaign: { source: source || "(not set)", medium: medium || "(not set)", campaign: campaign || "(not set)" },
    };
  }
  if (!host) return { channel: "direct", host: null, campaign: null };
  if (self && (host === self || host.endsWith(`.${self}`))) return { channel: "internal", host: null, campaign: null };
  if (SEARCH_HOST.some((re) => re.test(host))) return { channel: "organic", host, campaign: null };
  if (SOCIAL_HOST.some((re) => re.test(host))) return { channel: "social", host, campaign: null };
  return { channel: "referral", host, campaign: null };
}

export function classifyUserAgent(ua: string): { device: Device; browser: BrowserName; os: OsName } {
  const s = ua.toLowerCase();
  const os: OsName = /android/.test(s)
    ? "android"
    : /iphone|ipad|ipod/.test(s)
      ? "ios"
      : /cros/.test(s)
        ? "chromeos"
        : /windows/.test(s)
          ? "windows"
          : /mac os x|macintosh/.test(s)
            ? "macos"
            : /linux/.test(s)
              ? "linux"
              : "other";
  let device: Device = "desktop";
  if (!ua.trim()) device = "unknown";
  else if (/ipad|tablet|playbook|silk/.test(s) || (/android/.test(s) && !/mobile/.test(s))) device = "tablet";
  else if (/mobi|iphone|ipod|android/.test(s)) device = "mobile";
  const browser: BrowserName = /edg\//.test(s)
    ? "edge"
    : /samsungbrowser/.test(s)
      ? "samsung"
      : /firefox|fxios/.test(s)
        ? "firefox"
        : /chrome|crios|chromium/.test(s)
          ? "chrome"
          : /safari/.test(s)
            ? "safari"
            : "other";
  return { device, browser, os };
}

export const DEVICE_LABEL: Record<Device, string> = {
  mobile: "Mobile",
  desktop: "Desktop",
  tablet: "Tablet",
  unknown: "Unknown",
};

export const BROWSER_LABEL: Record<BrowserName, string> = {
  chrome: "Chrome",
  safari: "Safari",
  firefox: "Firefox",
  edge: "Edge",
  samsung: "Samsung Internet",
  other: "Other",
};

export const OS_LABEL: Record<OsName, string> = {
  windows: "Windows",
  macos: "macOS",
  ios: "iOS",
  android: "Android",
  linux: "Linux",
  chromeos: "ChromeOS",
  other: "Other",
};

/** Public paths that get a non-article page-view count. Article slugs are counted separately. */
export function shouldMeterPath(pathname: string): boolean {
  if (!pathname.startsWith("/") || pathname.length > 160) return false;
  if (pathname.includes("?") || pathname.includes("//") || pathname.includes("..")) return false;
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (/\.[a-z0-9]+$/i.test(path)) return false;
  if (/^\/(admin|api|media|preview|oauth|mcp|login)(\/|$)/.test(path)) return false;
  if (/^\/articles\/[^/]+$/.test(path)) return false;
  if (path.startsWith("/.well-known")) return false;
  return true;
}

export function hasDeskSessionCookie(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "dypol_desk" && rest.join("=").trim().length > 0) return true;
  }
  return false;
}
