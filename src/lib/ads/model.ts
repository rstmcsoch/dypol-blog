/**
 * t148: advertising model (pure, shared by server, client and admin).
 *
 * Principle: an empty slot is a normal website. A slot renders only when the
 * master switch is on, the slot is enabled, not hidden, inside its schedule,
 * targeted at this page/device and has at least one usable creative. Every
 * density rule here is an editable default with soft warnings — the owner
 * decides how many ads the site shows.
 */

export const AD_SIZES = ["728x90", "468x60", "300x250", "300x600", "160x600", "160x300", "320x50", "320x100", "300x50", "responsive"] as const;
export type AdSize = (typeof AD_SIZES)[number];
export const DEVICES = ["desktop", "tablet", "mobile"] as const;
export type Device = (typeof DEVICES)[number];
export const PAGE_TYPES = ["home", "article", "index", "topics", "topic", "about"] as const;
export type PageType = (typeof PAGE_TYPES)[number];
export const PAGE_TYPE_LABELS: Record<PageType, string> = {
  home: "Homepage",
  article: "Article",
  index: "All articles (/articles)",
  topics: "Topics list (/topics)",
  topic: "Single topic page",
  about: "About",
};
export const SLOT_IDS = ["G1", "G2", "G3", "G4", "H1", "H2", "H3", "H4", "H5", "H6", "H7", "A1", "A2", "A3", "A3b", "A4", "A5", "L1", "L2"] as const;
export type SlotId = (typeof SLOT_IDS)[number];
export type CreativeKind = "code" | "sponsor" | "native";
export type Network = "adsense" | "adsterra" | "gam" | "custom";
export type AdLabel = "Advertisement" | "Sponsored";

export type SlotDef = {
  id: SlotId;
  name: string;
  where: string;
  /** Page types this placement physically exists on. */
  pages: PageType[];
  /** Devices the placement can show on. */
  devices: Device[];
  /** Recommended size per device (first entry is the default). */
  sizes: Record<Device, AdSize[]>;
  optional: boolean;
  /** "grid" fills leftover grid cells only; "anchor" and "rail" are fixed elements. */
  kind: "block" | "grid" | "rail" | "anchor" | "inline" | "feed";
};

const ALL_DEVICES: Device[] = ["desktop", "tablet", "mobile"];
const CONTENT_PAGES: PageType[] = ["home", "article", "index", "topics", "topic", "about"];

export const SLOT_CATALOG: SlotDef[] = [
  { id: "G1", name: "Top leaderboard", where: "Under the ticker, above page content", pages: CONTENT_PAGES, devices: ALL_DEVICES, sizes: { desktop: ["728x90"], tablet: ["728x90", "468x60"], mobile: ["320x50", "320x100"] }, optional: false, kind: "block" },
  { id: "G2", name: "Side rails", where: "Left and right sticky rails beside the content (screens 1600 px and wider)", pages: CONTENT_PAGES, devices: ["desktop"], sizes: { desktop: ["160x600", "160x300"], tablet: [], mobile: [] }, optional: true, kind: "rail" },
  { id: "G3", name: "Above-footer banner", where: "After the last content block, before the footer", pages: CONTENT_PAGES, devices: ALL_DEVICES, sizes: { desktop: ["728x90", "468x60"], tablet: ["468x60", "728x90"], mobile: ["300x250", "320x100", "320x50"] }, optional: false, kind: "block" },
  { id: "G4", name: "Mobile sticky anchor", where: "Fixed bar at the bottom of phone screens, with a close button", pages: CONTENT_PAGES, devices: ["mobile"], sizes: { desktop: [], tablet: [], mobile: ["320x50"] }, optional: true, kind: "anchor" },
  { id: "H1", name: "After Also Filed", where: "Homepage, after the orange \"Also filed\" band", pages: ["home"], devices: ALL_DEVICES, sizes: { desktop: ["728x90"], tablet: ["468x60", "728x90"], mobile: ["300x250", "320x100"] }, optional: false, kind: "block" },
  { id: "H2", name: "Most read rail", where: "Homepage, under the Most read list (sticky); inline on phones", pages: ["home"], devices: ALL_DEVICES, sizes: { desktop: ["300x250", "300x600"], tablet: ["300x250"], mobile: ["300x250"] }, optional: false, kind: "block" },
  { id: "H3", name: "In-feed native", where: "Homepage, a native card after row 4 of the Latest list", pages: ["home"], devices: ALL_DEVICES, sizes: { desktop: ["responsive"], tablet: ["responsive"], mobile: ["responsive"] }, optional: true, kind: "feed" },
  { id: "H4", name: "In Focus small banner", where: "Homepage, under the In Focus mini cards (desktop)", pages: ["home"], devices: ["desktop"], sizes: { desktop: ["320x50", "468x60"], tablet: [], mobile: [] }, optional: true, kind: "inline" },
  { id: "H5", name: "Before Quick reads", where: "Homepage, before the Quick reads section", pages: ["home"], devices: ALL_DEVICES, sizes: { desktop: ["728x90"], tablet: ["468x60", "728x90"], mobile: ["300x250", "320x100"] }, optional: false, kind: "block" },
  { id: "H6", name: "You may also like tile", where: "Homepage, the empty cell(s) of the You may also like row", pages: ["home"], devices: ALL_DEVICES, sizes: { desktop: ["300x250"], tablet: ["300x250"], mobile: ["300x250"] }, optional: false, kind: "grid" },
  { id: "H7", name: "More stories leftover cells", where: "Homepage, leftover cells of the last More stories row, above Full index", pages: ["home"], devices: ALL_DEVICES, sizes: { desktop: ["300x250", "728x90"], tablet: ["300x250"], mobile: ["300x250"] }, optional: false, kind: "grid" },
  { id: "A1", name: "In-article 1", where: "Article, after paragraph 2", pages: ["article"], devices: ALL_DEVICES, sizes: { desktop: ["300x250", "468x60"], tablet: ["468x60", "300x250"], mobile: ["300x250", "320x100"] }, optional: false, kind: "block" },
  { id: "A2", name: "In-article 2", where: "Article, after paragraph 4 (long articles only)", pages: ["article"], devices: ALL_DEVICES, sizes: { desktop: ["300x250", "468x60"], tablet: ["468x60", "300x250"], mobile: ["300x250", "320x100"] }, optional: false, kind: "block" },
  { id: "A3", name: "Sidebar MPU", where: "Article sidebar, under You may also like (below the article on phones)", pages: ["article"], devices: ALL_DEVICES, sizes: { desktop: ["300x250"], tablet: ["300x250"], mobile: ["300x250"] }, optional: false, kind: "block" },
  { id: "A3b", name: "Sidebar tall sticky", where: "Article sidebar, under A3 (desktop)", pages: ["article"], devices: ["desktop"], sizes: { desktop: ["300x600", "160x600"], tablet: [], mobile: [] }, optional: false, kind: "block" },
  { id: "A4", name: "End of article", where: "Article, after the topic chips, before Related", pages: ["article"], devices: ALL_DEVICES, sizes: { desktop: ["468x60", "300x250"], tablet: ["468x60", "300x250"], mobile: ["300x250", "320x100"] }, optional: false, kind: "block" },
  { id: "A5", name: "Before Continue", where: "Article, before the Continue reading list", pages: ["article"], devices: ALL_DEVICES, sizes: { desktop: ["728x90"], tablet: ["468x60", "728x90"], mobile: ["300x250", "320x100"] }, optional: false, kind: "block" },
  { id: "L1", name: "Index list", where: "/articles, after row 6", pages: ["index"], devices: ALL_DEVICES, sizes: { desktop: ["728x90"], tablet: ["468x60", "728x90"], mobile: ["300x250", "320x100"] }, optional: false, kind: "block" },
  { id: "L2", name: "Topics grid leftover", where: "/topics, leftover cells of the last row", pages: ["topics"], devices: ALL_DEVICES, sizes: { desktop: ["300x250"], tablet: ["300x250"], mobile: ["300x250"] }, optional: false, kind: "grid" },
];

export function slotDef(id: string): SlotDef | undefined {
  return SLOT_CATALOG.find((s) => s.id === id);
}

export type DeviceCode = { html: string; size: AdSize; inherit: boolean };
export type Creative = {
  id: string;
  name: string;
  kind: CreativeKind;
  network: Network;
  enabled: boolean;
  weight: number;
  /** Render network code inside its own sandboxed frame (never for AdSense). */
  isolate: boolean;
  desktop: DeviceCode;
  tablet: DeviceCode;
  mobile: DeviceCode;
  sponsorId: string;
  /** Native cards (no code): headline + text, linked to the sponsor. */
  nativeTitle: string;
  nativeText: string;
};

export type Targeting = {
  pages: PageType[];
  devices: Device[];
  includeSlugs: string[];
  excludeSlugs: string[];
  includeTopics: string[];
  excludeTopics: string[];
};

export type Schedule = {
  /** ISO UTC; shown in IST in the admin. */
  start: string | null;
  end: string | null;
  /** Days of week in IST, 0 = Sunday. Empty = every day. */
  days: number[];
  /** "HH:MM" IST window; both empty = all day. Overnight windows allowed. */
  from: string;
  to: string;
};

export type SlotBody = {
  enabled: boolean;
  hidden: boolean;
  label: AdLabel;
  creatives: Creative[];
  rotation: "weighted" | "sponsor-first";
  /** Max impressions per visitor per day for each creative (0 = no cap). */
  frequencyCap: number;
  targeting: Targeting;
  schedule: Schedule;
  notes: string;
  /** Show the house ad when nothing else fills the slot. */
  houseFallback: boolean;
};

export type SlotConfig = SlotBody & {
  id: SlotId;
  updatedAt: string | null;
  updatedBy: string | null;
  draft: SlotBody | null;
};

export type SponsorBanner = { size: AdSize; key: string; width: number; height: number; mime: string; bytes: number; key2x: string | null; alt: string };
export type Sponsor = {
  id: string;
  name: string;
  logoKey: string | null;
  url: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  start: string | null;
  end: string | null;
  notes: string;
  banners: SponsorBanner[];
};

export type GlobalScript = {
  id: string;
  name: string;
  placement: "head" | "body";
  code: string;
  enabled: boolean;
  pages: PageType[];
  devices: Device[];
  schedule: Schedule;
  /** Wait for consent (when the consent banner applies). Off for a CMP's own code. */
  requiresConsent: boolean;
};

export type AdRules = {
  noBackToBack: boolean;
  maxInText: number;
  paragraphsBetween: number;
  firstAfterParagraph: number;
  a2MinParagraphs: number;
  continueAutoload: boolean;
  continueMax: number;
  firstMobileScreenOne: boolean;
};

export type ConsentSettings = {
  enabled: boolean;
  scope: "all" | "eea";
  text: string;
  accept: string;
  reject: string;
  /**
   * t161: a certified consent tool's head code (Consent Mode default + CMP
   * loader). Inserted verbatim right after <meta charset> on every public
   * page, ads on or off, ahead of all other scripts. When set, the simple
   * banner above and the analytics cookie bar stay off (the CMP owns consent).
   */
  cmpHead: string;
};

export type HouseAd = { title: string; text: string; url: string; cta: string };

export type AdsSettings = {
  master: boolean;
  slots: SlotConfig[];
  sponsors: Sponsor[];
  scripts: GlobalScript[];
  adsTxt: string;
  rules: AdRules;
  consent: ConsentSettings;
  house: HouseAd;
  /** Article slug → sponsor id: shows "Sponsored by …" and drops network ads. */
  sponsoredArticles: { slug: string; sponsorId: string }[];
  networks: { adsense: string; adsterra: string; gam: string };
};

export const DEFAULT_RULES: AdRules = {
  noBackToBack: true,
  maxInText: 2,
  paragraphsBetween: 2,
  firstAfterParagraph: 2,
  a2MinParagraphs: 5,
  continueAutoload: false,
  continueMax: 3,
  firstMobileScreenOne: true,
};

export function emptySchedule(): Schedule {
  return { start: null, end: null, days: [], from: "", to: "" };
}

export function emptyDeviceCode(size: AdSize = "300x250", inherit = false): DeviceCode {
  return { html: "", size, inherit };
}

export function defaultTargeting(def: SlotDef): Targeting {
  const pages = def.id === "G1" || def.id === "G3" || def.id === "G2" || def.id === "G4" ? def.pages.filter((p) => p !== "about") : [...def.pages];
  return { pages, devices: [...def.devices], includeSlugs: [], excludeSlugs: [], includeTopics: [], excludeTopics: [] };
}

export function newCreative(def: SlotDef, id: string, kind: CreativeKind = "code"): Creative {
  const size = (d: Device): AdSize => def.sizes[d][0] ?? def.sizes.desktop[0] ?? "300x250";
  return {
    id,
    name: kind === "sponsor" ? "Sponsor banner" : kind === "native" ? "Native card" : "Network code",
    kind,
    network: "custom",
    enabled: true,
    weight: 1,
    isolate: false,
    desktop: emptyDeviceCode(size("desktop")),
    tablet: emptyDeviceCode(size("tablet"), true),
    mobile: emptyDeviceCode(size("mobile"), true),
    sponsorId: "",
    nativeTitle: "",
    nativeText: "",
  };
}

export function defaultSlot(def: SlotDef): SlotConfig {
  return {
    id: def.id,
    enabled: !def.optional,
    hidden: false,
    label: "Advertisement",
    creatives: [],
    rotation: "weighted",
    frequencyCap: 0,
    targeting: defaultTargeting(def),
    schedule: emptySchedule(),
    notes: "",
    houseFallback: false,
    updatedAt: null,
    updatedBy: null,
    draft: null,
  };
}

export function defaultAdsSettings(): AdsSettings {
  return {
    master: true,
    slots: SLOT_CATALOG.map(defaultSlot),
    sponsors: [],
    scripts: [],
    adsTxt: "",
    rules: { ...DEFAULT_RULES },
    consent: {
      enabled: false,
      scope: "eea",
      text: "We and our advertising partners use cookies to show and measure ads. You can accept or decline; the site works either way.",
      accept: "Accept",
      reject: "Decline",
      cmpHead: "",
    },
    house: { title: "", text: "", url: "", cta: "Learn more" },
    sponsoredArticles: [],
    networks: { adsense: "https://www.google.com/adsense/", adsterra: "https://beta.publishers.adsterra.com/", gam: "https://admanager.google.com/" },
  };
}

// ---------- normalisation (tolerant: bad input becomes a safe default) ----------
const str = (v: unknown, max = 200): string => (typeof v === "string" ? v.slice(0, max) : "");
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
const int = (v: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const listOf = <T extends string>(v: unknown, list: readonly T[]): T[] => (Array.isArray(v) ? list.filter((x) => v.includes(x)) : []);
const words = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\n,]/) : [])
    .map((x) => (typeof x === "string" ? x.trim().toLowerCase() : ""))
    .filter(Boolean)
    .slice(0, 200);
const isoOrNull = (v: unknown): string | null => {
  if (typeof v !== "string" || !v.trim()) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
const hhmm = (v: unknown): string => (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : "");
const CODE_MAX = 60_000;

export function normalizeSchedule(raw: unknown): Schedule {
  const r = (raw ?? {}) as Record<string, unknown>;
  const days = Array.isArray(r.days) ? [...new Set(r.days.map((d) => int(d, -1, -1, 6)).filter((d) => d >= 0))].sort() : [];
  return { start: isoOrNull(r.start), end: isoOrNull(r.end), days, from: hhmm(r.from), to: hhmm(r.to) };
}

function normalizeDeviceCode(raw: unknown, fallbackSize: AdSize, inheritDefault: boolean): DeviceCode {
  const r = (raw ?? {}) as Record<string, unknown>;
  return { html: str(r.html, CODE_MAX), size: oneOf(r.size, AD_SIZES, fallbackSize), inherit: bool(r.inherit, inheritDefault) };
}

export function normalizeCreative(raw: unknown, def: SlotDef, index: number): Creative {
  const r = (raw ?? {}) as Record<string, unknown>;
  const base = newCreative(def, str(r.id, 40).replace(/[^\w-]/g, "") || `${def.id.toLowerCase()}-c${index + 1}`, oneOf(r.kind, ["code", "sponsor", "native"] as const, "code"));
  return {
    ...base,
    name: str(r.name, 80) || base.name,
    network: oneOf(r.network, ["adsense", "adsterra", "gam", "custom"] as const, "custom"),
    enabled: bool(r.enabled, true),
    weight: int(r.weight, 1, 0, 1000),
    isolate: bool(r.isolate, false),
    desktop: normalizeDeviceCode(r.desktop, base.desktop.size, false),
    tablet: normalizeDeviceCode(r.tablet, base.tablet.size, true),
    mobile: normalizeDeviceCode(r.mobile, base.mobile.size, true),
    sponsorId: str(r.sponsorId, 40),
    nativeTitle: str(r.nativeTitle, 120),
    nativeText: str(r.nativeText, 300),
  };
}

function normalizeBody(raw: unknown, def: SlotDef): SlotBody {
  const r = (raw ?? {}) as Record<string, unknown>;
  const base = defaultSlot(def);
  const t = (r.targeting ?? {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const creatives = (Array.isArray(r.creatives) ? r.creatives : [])
    .slice(0, 20)
    .map((c, i) => normalizeCreative(c, def, i))
    .map((c, i) => {
      let id = c.id;
      while (seen.has(id)) id = `${c.id}-${i}`;
      seen.add(id);
      return { ...c, id };
    });
  return {
    enabled: bool(r.enabled, base.enabled),
    hidden: bool(r.hidden, false),
    label: oneOf(r.label, ["Advertisement", "Sponsored"] as const, "Advertisement"),
    creatives,
    rotation: oneOf(r.rotation, ["weighted", "sponsor-first"] as const, "weighted"),
    frequencyCap: int(r.frequencyCap, 0, 0, 1000),
    targeting: {
      pages: Array.isArray(t.pages) ? listOf(t.pages, def.pages) : base.targeting.pages,
      devices: Array.isArray(t.devices) ? listOf(t.devices, def.devices) : base.targeting.devices,
      includeSlugs: words(t.includeSlugs),
      excludeSlugs: words(t.excludeSlugs),
      includeTopics: words(t.includeTopics),
      excludeTopics: words(t.excludeTopics),
    },
    schedule: normalizeSchedule(r.schedule),
    notes: str(r.notes, 2000),
    houseFallback: bool(r.houseFallback, false),
  };
}

export function normalizeSlot(raw: unknown, def: SlotDef): SlotConfig {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    ...normalizeBody(raw, def),
    id: def.id,
    updatedAt: isoOrNull(r.updatedAt),
    updatedBy: str(r.updatedBy, 120) || null,
    draft: r.draft && typeof r.draft === "object" ? normalizeBody(r.draft, def) : null,
  };
}

function normalizeSponsor(raw: unknown, i: number): Sponsor {
  const r = (raw ?? {}) as Record<string, unknown>;
  const banners = (Array.isArray(r.banners) ? r.banners : [])
    .map((b) => {
      const x = (b ?? {}) as Record<string, unknown>;
      return {
        size: oneOf(x.size, AD_SIZES, "300x250"),
        key: str(x.key, 200),
        width: int(x.width, 0, 0, 4000),
        height: int(x.height, 0, 0, 4000),
        mime: str(x.mime, 40),
        bytes: int(x.bytes, 0, 0, 10_000_000),
        key2x: str(x.key2x, 200) || null,
        alt: str(x.alt, 200),
      } satisfies SponsorBanner;
    })
    .filter((b) => b.key && /^ads\//.test(b.key));
  return {
    id: str(r.id, 40).replace(/[^\w-]/g, "") || `sp-${i + 1}`,
    name: str(r.name, 80),
    logoKey: str(r.logoKey, 200) || null,
    url: safeHttpUrl(str(r.url, 600)) ?? "",
    utmSource: str(r.utmSource, 80) || "dypol-blog",
    utmMedium: str(r.utmMedium, 80) || "banner",
    utmCampaign: str(r.utmCampaign, 80),
    start: isoOrNull(r.start),
    end: isoOrNull(r.end),
    notes: str(r.notes, 2000),
    banners,
  };
}

function normalizeScript(raw: unknown, i: number): GlobalScript {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: str(r.id, 40).replace(/[^\w-]/g, "") || `script-${i + 1}`,
    name: str(r.name, 80) || `Script ${i + 1}`,
    placement: oneOf(r.placement, ["head", "body"] as const, "body"),
    code: str(r.code, CODE_MAX),
    enabled: bool(r.enabled, false),
    pages: Array.isArray(r.pages) ? listOf(r.pages, PAGE_TYPES) : [...PAGE_TYPES],
    devices: Array.isArray(r.devices) ? listOf(r.devices, DEVICES) : [...DEVICES],
    schedule: normalizeSchedule(r.schedule),
    requiresConsent: bool(r.requiresConsent, true),
  };
}

export function normalizeAdsSettings(raw: unknown): AdsSettings {
  const d = defaultAdsSettings();
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawSlots = Array.isArray(r.slots) ? (r.slots as Array<Record<string, unknown>>) : [];
  const rules = (r.rules ?? {}) as Record<string, unknown>;
  const consent = (r.consent ?? {}) as Record<string, unknown>;
  const house = (r.house ?? {}) as Record<string, unknown>;
  const networks = (r.networks ?? {}) as Record<string, unknown>;
  const sponsors = (Array.isArray(r.sponsors) ? r.sponsors : []).slice(0, 100).map(normalizeSponsor);
  const sponsorIds = new Set(sponsors.map((s) => s.id));
  return {
    master: bool(r.master, d.master),
    slots: SLOT_CATALOG.map((def) => normalizeSlot(rawSlots.find((s) => s && s.id === def.id), def)),
    sponsors,
    scripts: (Array.isArray(r.scripts) ? r.scripts : []).slice(0, 30).map(normalizeScript),
    adsTxt: str(r.adsTxt, 50_000),
    rules: {
      noBackToBack: bool(rules.noBackToBack, DEFAULT_RULES.noBackToBack),
      maxInText: int(rules.maxInText, DEFAULT_RULES.maxInText, 0, 20),
      paragraphsBetween: int(rules.paragraphsBetween, DEFAULT_RULES.paragraphsBetween, 1, 20),
      firstAfterParagraph: int(rules.firstAfterParagraph, DEFAULT_RULES.firstAfterParagraph, 1, 20),
      a2MinParagraphs: int(rules.a2MinParagraphs, DEFAULT_RULES.a2MinParagraphs, 1, 50),
      continueAutoload: bool(rules.continueAutoload, DEFAULT_RULES.continueAutoload),
      continueMax: int(rules.continueMax, DEFAULT_RULES.continueMax, 0, 10),
      firstMobileScreenOne: bool(rules.firstMobileScreenOne, DEFAULT_RULES.firstMobileScreenOne),
    },
    consent: {
      enabled: bool(consent.enabled, d.consent.enabled),
      scope: oneOf(consent.scope, ["all", "eea"] as const, d.consent.scope),
      text: str(consent.text, 600) || d.consent.text,
      accept: str(consent.accept, 40) || d.consent.accept,
      reject: str(consent.reject, 40) || d.consent.reject,
      cmpHead: str(consent.cmpHead, 20000),
    },
    house: {
      title: str(house.title, 120),
      text: str(house.text, 300),
      url: safeHttpUrl(str(house.url, 600)) ?? (str(house.url, 600).startsWith("/") ? str(house.url, 600) : ""),
      cta: str(house.cta, 40) || d.house.cta,
    },
    sponsoredArticles: (Array.isArray(r.sponsoredArticles) ? r.sponsoredArticles : [])
      .map((x) => ({ slug: str((x as Record<string, unknown>)?.slug, 200).trim().toLowerCase(), sponsorId: str((x as Record<string, unknown>)?.sponsorId, 40) }))
      .filter((x) => x.slug && sponsorIds.has(x.sponsorId))
      .slice(0, 500),
    networks: {
      adsense: safeHttpUrl(str(networks.adsense, 300)) ?? d.networks.adsense,
      adsterra: safeHttpUrl(str(networks.adsterra, 300)) ?? d.networks.adsterra,
      gam: safeHttpUrl(str(networks.gam, 300)) ?? d.networks.gam,
    },
  };
}

export function safeHttpUrl(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// ---------- sizes, devices ----------
export function sizeDims(size: AdSize): { w: number; h: number } | null {
  if (size === "responsive") return null;
  const [w, h] = size.split("x").map(Number);
  return { w, h };
}

/**
 * The size written in the ad code itself (Adsterra's atOptions width/height). The network
 * draws its iframe at this size whatever the slot's Size setting says, so the frame
 * should match it. Null when the code does not state one.
 */
export function codeDims(html: string | null | undefined): { w: number; h: number } | null {
  if (!html || !/atOptions/.test(html)) return null;
  const num = (k: string) => {
    const m = new RegExp(`['"]?${k}['"]?\\s*:\\s*['"]?(\\d{2,4})`).exec(html);
    return m ? Number(m[1]) : 0;
  };
  const w = num("width");
  const h = num("height");
  return w >= 20 && w <= 2000 && h >= 20 && h <= 2000 ? { w, h } : null;
}

export function deviceForWidth(width: number): Device {
  return width < 768 ? "mobile" : width < 1024 ? "tablet" : "desktop";
}

/** The code a device actually uses ("use desktop code" falls back to desktop). */
export function codeFor(c: Creative, device: Device): DeviceCode | null {
  const own = c[device];
  if (device !== "desktop" && own.inherit) {
    return { ...c.desktop, inherit: true };
  }
  return own;
}

/** Usable on this device: has code (or a sponsor banner / native text) for it. */
export function creativeUsableOn(c: Creative, device: Device, sponsors: Map<string, Sponsor>): boolean {
  if (!c.enabled || c.weight <= 0) return false;
  const code = codeFor(c, device);
  if (!code) return false;
  if (c.kind === "code") return code.html.trim().length > 0;
  const sp = sponsors.get(c.sponsorId);
  if (!sp || !sp.url) return false;
  if (c.kind === "native") return code.html.trim().length > 0 || c.nativeTitle.trim().length > 0;
  return sp.banners.some((b) => b.size === code.size);
}

// ---------- schedule (dates in UTC, days/time window in IST) ----------
const IST_OFFSET_MS = 330 * 60_000;

export function inSchedule(s: Schedule, nowMs: number): boolean {
  if (s.start && nowMs < Date.parse(s.start)) return false;
  if (s.end && nowMs >= Date.parse(s.end)) return false;
  const ist = new Date(nowMs + IST_OFFSET_MS);
  if (s.days.length && !s.days.includes(ist.getUTCDay())) return false;
  if (s.from && s.to) {
    const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    const [fh, fm] = s.from.split(":").map(Number);
    const [th, tm] = s.to.split(":").map(Number);
    const a = fh * 60 + fm;
    const b = th * 60 + tm;
    const inside = a <= b ? minutes >= a && minutes < b : minutes >= a || minutes < b;
    if (!inside) return false;
  }
  return true;
}

export function sponsorLive(sp: Sponsor, nowMs: number): boolean {
  if (sp.start && nowMs < Date.parse(sp.start)) return false;
  if (sp.end && nowMs >= Date.parse(sp.end)) return false;
  return true;
}

export type SlotStatus = "Live" | "Off" | "Hidden" | "Scheduled" | "Expired" | "No code";

export function slotStatus(slot: SlotConfig, settings: Pick<AdsSettings, "master" | "sponsors">, nowMs: number): SlotStatus {
  if (!settings.master || !slot.enabled) return "Off";
  if (slot.hidden) return "Hidden";
  const sponsors = new Map(settings.sponsors.map((s) => [s.id, s]));
  const usable = slot.creatives.some((c) => DEVICES.some((d) => creativeUsableOn(c, d, sponsors) && (c.kind === "code" || sponsorLive(sponsors.get(c.sponsorId)!, nowMs))));
  if (!usable) return "No code";
  if (slot.schedule.end && nowMs >= Date.parse(slot.schedule.end)) return "Expired";
  if (!inSchedule(slot.schedule, nowMs)) return "Scheduled";
  return "Live";
}

// ---------- targeting ----------
export type AdPageContext = { type: PageType; slug?: string; topics?: string[]; sponsored?: boolean };

export function targets(t: Targeting, page: AdPageContext): boolean {
  if (!t.pages.includes(page.type)) return false;
  const slug = (page.slug ?? "").toLowerCase();
  const topics = (page.topics ?? []).map((x) => x.toLowerCase());
  if (t.includeSlugs.length && !t.includeSlugs.includes(slug)) return false;
  if (slug && t.excludeSlugs.includes(slug)) return false;
  if (t.includeTopics.length && !topics.some((x) => t.includeTopics.includes(x))) return false;
  if (topics.some((x) => t.excludeTopics.includes(x))) return false;
  return true;
}

// ---------- rotation ----------
/** Deterministic 0..1 from a seed and a key (same on server and client). */
export function seeded(seed: number, key: string): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < key.length; i += 1) {
    h = Math.imul(h ^ key.charCodeAt(i), 0x85ebca6b) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35) >>> 0;
  return (h >>> 0) / 0x1_0000_0000;
}

export function pickCreative<T extends { id: string; kind: CreativeKind; weight: number }>(list: T[], rotation: SlotBody["rotation"], rand: number, excluded: ReadonlySet<string> = new Set()): T | null {
  let pool = list.filter((c) => c.weight > 0 && !excluded.has(c.id));
  if (!pool.length) return null;
  if (rotation === "sponsor-first") {
    const sponsored = pool.filter((c) => c.kind !== "code");
    if (sponsored.length) pool = sponsored;
  }
  const total = pool.reduce((sum, c) => sum + c.weight, 0);
  let x = rand * total;
  for (const c of pool) {
    x -= c.weight;
    if (x < 0) return c;
  }
  return pool[pool.length - 1];
}

// ---------- in-article placement ----------
export type BlockShape = { type: string; embed?: boolean };

/**
 * Block indices after which an in-text ad goes (first = A1, then A2 …).
 * Only between two real paragraphs (never beside a subhead, callout, image,
 * embed or the sources list), at least `paragraphsBetween` paragraphs apart.
 */
export function inTextPositions(blocks: BlockShape[], rules: Pick<AdRules, "maxInText" | "paragraphsBetween" | "firstAfterParagraph" | "a2MinParagraphs">): number[] {
  const isPara = (b: BlockShape | undefined) => !!b && b.type === "paragraph" && !b.embed;
  const total = blocks.filter(isPara).length;
  const out: number[] = [];
  if (rules.maxInText <= 0) return out;
  let count = 0;
  let target = rules.firstAfterParagraph;
  for (let i = 0; i < blocks.length && out.length < rules.maxInText; i += 1) {
    if (!isPara(blocks[i])) continue;
    count += 1;
    if (count < target) continue;
    // Only at a natural break: before another paragraph or a new section heading.
    const next = blocks[i + 1];
    if (!isPara(next) && next?.type !== "heading") continue;
    if (out.length >= 1 && total < rules.a2MinParagraphs) break;
    out.push(i);
    target = count + rules.paragraphsBetween;
  }
  return out;
}

// ---------- soft warnings ----------
const NEIGHBOURS: [SlotId, SlotId, string][] = [
  ["A4", "A5", "on articles without a Related list"],
  ["H7", "G3", "at the end of the homepage when More stories is the last block"],
  ["G1", "H1", "when the homepage has no lead story"],
  ["A5", "G3", "on articles without a Continue list"],
];

export function densityWarnings(settings: AdsSettings, nowMs: number): string[] {
  const live = new Set(settings.slots.filter((s) => slotStatus(s, settings, nowMs) === "Live").map((s) => s.id));
  const out: string[] = [];
  if (settings.rules.noBackToBack) {
    for (const [a, b, when] of NEIGHBOURS) {
      if (live.has(a) && live.has(b)) out.push(`${a} and ${b} can sit next to each other ${when}; the second one is skipped there while "No back-to-back ads" is on.`);
    }
  }
  const inText = ["A1", "A2"].filter((id) => live.has(id as SlotId)).length;
  if (inText && settings.rules.maxInText > 3) out.push(`Up to ${settings.rules.maxInText} ads can appear inside one article's text. Readers may find long articles busy.`);
  if (settings.rules.paragraphsBetween < 2 && inText) out.push("In-text ads can appear with fewer than 2 paragraphs between them.");
  if (!settings.rules.firstMobileScreenOne && live.has("G1")) out.push("On phones the first screen may show an ad before the headline (the first-screen rule is off).");
  if (live.has("G4") && settings.consent.enabled) out.push("The consent banner sits above the mobile anchor (G4) so they never overlap.");
  return out;
}

/** Page type for a public path; null = never any ads (legal pages, contact, search, admin …). */
export function pageTypeForPath(pathname: string): PageType | null {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (p === "/" || p === "") return "home";
  if (p === "/articles") return "index";
  if (/^\/articles\/[^/]+$/.test(p)) return "article";
  if (p === "/topics") return "topics";
  if (/^\/topics\/[^/]+$/.test(p)) return "topic";
  if (p === "/about") return "about";
  return null;
}
