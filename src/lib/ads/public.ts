/**
 * t148: what the public site receives — only live slots, never notes, drafts,
 * history or editor metadata. Returns null when nothing can render, so the
 * page markup is exactly the ad-free site.
 */
import {
  DEVICES,
  codeFor,
  creativeUsableOn,
  inSchedule,
  slotDef,
  sponsorLive,
  type AdRules,
  type AdSize,
  type AdsSettings,
  type CreativeKind,
  type Device,
  type HouseAd,
  type Network,
  type PageType,
  type Sponsor,
  type Targeting,
} from "./model.ts";

export type PublicBanner = { src: string; src2x: string | null; w: number; h: number; alt: string };
export type PublicCreative = {
  id: string;
  kind: CreativeKind;
  network: Network;
  weight: number;
  isolate: boolean;
  /** Per device: code or banner. Missing device = not shown there. */
  code: Partial<Record<Device, { html: string; size: AdSize }>>;
  banners: Partial<Record<Device, PublicBanner>>;
  sponsorName: string;
  nativeTitle: string;
  nativeText: string;
  href: string | null;
};
export type PublicSlot = {
  id: string;
  label: string;
  rotation: "weighted" | "sponsor-first";
  cap: number;
  targeting: Targeting;
  creatives: PublicCreative[];
  house: boolean;
};
export type PublicScript = { id: string; placement: "head" | "body"; code: string; pages: PageType[]; devices: Device[]; consent: boolean };
export type PublicAds = {
  slots: Record<string, PublicSlot>;
  scripts: PublicScript[];
  rules: AdRules;
  /** Present when the visitor must be asked before network code runs. */
  consent: { text: string; accept: string; reject: string } | null;
  house: HouseAd | null;
  sponsored: Record<string, string>;
  seed: number;
};

/** EEA + EFTA + UK (GDPR / UK GDPR). */
export const EEA_UK = new Set("AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO GB CH".split(" "));

export function adMediaUrl(key: string): string {
  return `/ad-media/${key.replace(/^ads\//, "")}`;
}

function banner(sp: Sponsor, size: AdSize): PublicBanner | null {
  const b = sp.banners.find((x) => x.size === size);
  if (!b) return null;
  return { src: adMediaUrl(b.key), src2x: b.key2x ? adMediaUrl(b.key2x) : null, w: b.width, h: b.height, alt: b.alt || sp.name };
}

export function buildPublicAds(settings: AdsSettings, nowMs: number, opts: { country?: string | null; seed: number }): PublicAds | null {
  if (!settings.master) return null;
  const sponsors = new Map(settings.sponsors.map((s) => [s.id, s]));
  const houseOk = !!(settings.house.title.trim() && settings.house.url);
  const slots: Record<string, PublicSlot> = {};
  let networkCode = false;
  for (const slot of settings.slots) {
    const def = slotDef(slot.id);
    if (!def || !slot.enabled || slot.hidden || !inSchedule(slot.schedule, nowMs)) continue;
    const creatives: PublicCreative[] = [];
    for (const c of slot.creatives) {
      const sp = sponsors.get(c.sponsorId);
      if (c.kind !== "code" && (!sp || !sponsorLive(sp, nowMs))) continue;
      const out: PublicCreative = {
        id: c.id,
        kind: c.kind,
        network: c.network,
        weight: c.weight,
        isolate: c.isolate && c.network !== "adsense",
        code: {},
        banners: {},
        sponsorName: sp?.name ?? "",
        nativeTitle: c.nativeTitle,
        nativeText: c.nativeText,
        href: c.kind !== "code" ? `/ad-click/${encodeURIComponent(c.id)}?s=${slot.id}` : null,
      };
      for (const d of DEVICES) {
        if (!def.devices.includes(d) || !slot.targeting.devices.includes(d)) continue;
        if (!creativeUsableOn(c, d, sponsors)) continue;
        const code = codeFor(c, d)!;
        if (c.kind === "sponsor" && sp) {
          const b = banner(sp, code.size);
          if (b) out.banners[d] = b;
        } else if (code.html.trim()) {
          out.code[d] = { html: code.html, size: code.size };
        } else if (c.kind === "native") {
          out.code[d] = { html: "", size: "responsive" };
        }
      }
      if (Object.keys(out.code).length || Object.keys(out.banners).length) {
        creatives.push(out);
        if (c.kind === "code" || (c.kind === "native" && Object.values(out.code).some((x) => x?.html))) networkCode = true;
      }
    }
    const house = slot.houseFallback && houseOk;
    if (!creatives.length && !house) continue;
    slots[slot.id] = { id: slot.id, label: slot.label, rotation: slot.rotation, cap: slot.frequencyCap, targeting: slot.targeting, creatives, house };
  }
  const scripts: PublicScript[] = settings.scripts
    .filter((s) => s.enabled && s.code.trim() && inSchedule(s.schedule, nowMs))
    .map((s) => ({ id: s.id, placement: s.placement, code: s.code, pages: s.pages, devices: s.devices, consent: s.requiresConsent }));
  const country = (opts.country ?? "").toUpperCase();
  const needsConsent = !settings.consent.cmpHead.trim() && settings.consent.enabled && (settings.consent.scope === "all" || !country || EEA_UK.has(country)) && (networkCode || scripts.some((s) => s.consent));
  const sponsored: Record<string, string> = {};
  for (const a of settings.sponsoredArticles) {
    const sp = sponsors.get(a.sponsorId);
    if (sp) sponsored[a.slug] = sp.name;
  }
  if (!Object.keys(slots).length && !scripts.length && !Object.keys(sponsored).length) return null;
  return {
    slots,
    scripts,
    rules: settings.rules,
    consent: needsConsent ? { text: settings.consent.text, accept: settings.consent.accept, reject: settings.consent.reject } : null,
    house: houseOk ? settings.house : null,
    sponsored,
    seed: opts.seed >>> 0,
  };
}

/** Click-through URL with UTM tags (never overrides tags already in the link). */
export function sponsorTarget(sp: Sponsor, slotId: string): string | null {
  if (!sp.url) return null;
  try {
    const u = new URL(sp.url);
    const set = (k: string, v: string) => {
      if (v && !u.searchParams.has(k)) u.searchParams.set(k, v);
    };
    set("utm_source", sp.utmSource);
    set("utm_medium", sp.utmMedium);
    set("utm_campaign", sp.utmCampaign || sp.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    set("utm_content", slotId);
    return u.toString();
  } catch {
    return null;
  }
}
