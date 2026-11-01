/**
 * t148: the one ad slot component and its page plumbing.
 *
 * An inactive slot returns null — no wrapper, no reserved space, no script —
 * so with the master switch off (or no code anywhere) the page is the plain
 * site. Active slots render one <aside>, reserve the creative's height per
 * breakpoint, load network code only when near the viewport (and after
 * consent when required) and collapse when the network does not fill.
 */
import { createContext, createElement, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { getRouteApi, useRouterState } from "@tanstack/react-router";
import { DEVICES, pageTypeForPath, pickCreative, seeded, sizeDims, slotDef, targets, type AdPageContext, type AdSize, type Device, type SlotId } from "@/lib/ads/model";
import type { PublicAds, PublicCreative, PublicSlot } from "@/lib/ads/public";
import { parseHeadHtml, reactProps } from "@/lib/ads/head-html";
import {
  anchorClosed,
  capReached,
  closeAnchor,
  consentChoice,
  currentDevice,
  injectGlobal,
  injectHtml,
  isolatedFrame,
  noAdsRequested,
  noteCapView,
  onConsentChange,
  resetPageRules,
  setConsentChoice,
  suppressedByRules,
  trackImpression,
  watchFill,
  whenNear,
} from "@/lib/ads/runtime";

const rootRoute = getRouteApi("__root__");

export function useAds(): PublicAds | null {
  const data = rootRoute.useLoaderData() as { ads?: PublicAds | null } | undefined;
  return data?.ads ?? null;
}

// ---------- tiny client stores (server snapshot = off, so hydration matches) ----------
function store(initial: boolean) {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set: (v: boolean) => {
      value = v;
      subs.forEach((fn) => fn());
    },
    subscribe: (fn: () => void) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
const previewStore = store(false);
const noAdsStore = store(false);
const consentStore = store(false);
const off = () => false;

export function usePreview(): boolean {
  return useSyncExternalStore(previewStore.subscribe, previewStore.get, off);
}
function useNoAds(): boolean {
  return useSyncExternalStore(noAdsStore.subscribe, noAdsStore.get, off);
}
function useConsentTick(): boolean {
  return useSyncExternalStore(consentStore.subscribe, consentStore.get, off);
}

// ---------- page context ----------
const PageCtx = createContext<AdPageContext | null>(null);

type Resolved = { slot: PublicSlot; creative: PublicCreative | null; list: PublicCreative[]; house: PublicAds["house"]; ads: PublicAds; page: AdPageContext };

function useResolved(id: SlotId, occurrence: number): Resolved | null {
  const ads = useAds();
  const page = useContext(PageCtx);
  const noads = useNoAds();
  return useMemo(() => {
    if (!ads || !page || noads) return null;
    const slot = ads.slots[id];
    if (!slot || !targets(slot.targeting, page)) return null;
    const list = page.sponsored ? slot.creatives.filter((c) => c.kind !== "code") : slot.creatives;
    const creative = pickCreative(list, slot.rotation, seeded(ads.seed, `${id}:${occurrence}:${page.slug ?? page.type}`));
    const house = slot.house ? ads.house : null;
    if (!creative && !house) return null;
    return { slot, creative, list, house, ads, page };
  }, [ads, page, noads, id, occurrence]);
}

/** Lets a parent add a wrapper only when the slot will render. */
export function useSlotActive(id: SlotId): boolean {
  const preview = usePreview();
  const r = useResolved(id, 0);
  return preview || !!r;
}

/** Wrap a public page: provides targeting context and the global slots. */
export function AdPage({ page, children }: { page: AdPageContext; children: ReactNode }) {
  const value = useMemo(() => page, [page.type, page.slug, page.sponsored, (page.topics ?? []).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    resetPageRules();
  }, [value]);
  return (
    <PageCtx.Provider value={value}>
      <AdSlot id="G1" wrap="container" />
      {children}
      <AdSlot id="G3" wrap="container" />
      <AdSlot id="G2" wrap="rail" occurrence={0} />
      <AdSlot id="G2" wrap="rail" occurrence={1} />
      <AdSlot id="G4" wrap="anchor" />
    </PageCtx.Provider>
  );
}

type Wrap = "container" | "rail" | "anchor" | "li" | "cell" | undefined;

export function AdSlot({ id, occurrence = 0, wrap }: { id: SlotId; occurrence?: number; wrap?: Wrap }) {
  const preview = usePreview();
  const r = useResolved(id, occurrence);
  const page = useContext(PageCtx);
  if (preview && page) return <PreviewBox id={id} wrap={wrap} occurrence={occurrence} />;
  if (!r) return null;
  return <AdBox key={`${id}-${occurrence}-${r.creative?.id ?? "house"}`} r={r} id={id} occurrence={occurrence} wrap={wrap} />;
}

function frameVars(heights: Partial<Record<Device, number>>): CSSProperties {
  const vars: Record<string, string> = {};
  for (const d of DEVICES) if (heights[d]) vars[`--ad-h-${d}`] = `${heights[d]}px`;
  return vars as CSSProperties;
}

function sizeOf(c: PublicCreative, d: Device): { w: number; h: number } | null {
  const b = c.banners[d];
  if (b) return { w: b.w, h: b.h };
  const code = c.code[d];
  return code ? sizeDims(code.size) : null;
}

function wrapNode(wrap: Wrap, id: SlotId, occurrence: number, node: ReactNode, liRef?: React.Ref<HTMLLIElement>, hidden?: boolean): ReactNode {
  if (wrap === "container") return <div className={`container ad-wrap ad-wrap--${id}`}>{node}</div>;
  if (wrap === "rail") return <div className={`ad-rail ad-rail--${occurrence ? "right" : "left"}`} aria-hidden={undefined}><div className="ad-rail__inner">{node}</div></div>;
  if (wrap === "anchor") return <div className="ad-anchor">{node}</div>;
  if (wrap === "li") return <li className="ad-li">{node}</li>;
  if (wrap === "cell") return <li className="ad-cell" ref={liRef} hidden={hidden}>{node}</li>;
  return node;
}

function useGridCell(enabled: boolean) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const li = ref.current;
    const grid = li?.parentElement;
    if (!enabled || !li || !grid) return;
    const fit = () => {
      const cols = getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length || 1;
      const n = Array.from(grid.children).filter((ch) => ch !== li && !ch.classList.contains("ad-cell") && !(ch as HTMLElement).hidden).length;
      const free = cols === 1 ? 1 : (cols - (n % cols)) % cols;
      li.hidden = free === 0;
      li.style.gridColumn = free > 1 ? `span ${free}` : "";
    };
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    ro?.observe(grid);
    return () => ro?.disconnect();
  }, [enabled]);
  return ref;
}

function AdBox({ r, id, occurrence, wrap }: { r: Resolved; id: SlotId; occurrence: number; wrap: Wrap }) {
  const { slot, list, house, ads } = r;
  const [creative, setCreative] = useState<PublicCreative | null>(r.creative);
  const [useHouse, setUseHouse] = useState(!r.creative);
  const [collapsed, setCollapsed] = useState(false);
  const [closed, setClosed] = useState(false);
  const consentTick = useConsentTick();
  const asideRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const cellRef = useGridCell(wrap === "cell");
  const def = slotDef(id);
  const showing = useHouse ? null : creative;
  const devices = DEVICES.filter((d) => (showing ? !!(showing.code[d] || showing.banners[d]) : (def?.devices ?? DEVICES).includes(d) && slot.targeting.devices.includes(d)));
  const heights: Partial<Record<Device, number>> = {};
  if (showing) for (const d of devices) heights[d] = sizeOf(showing, d)?.h ?? 0;

  useEffect(() => {
    const el = asideRef.current;
    const frame = frameRef.current;
    if (!el || !frame) return;
    const cleanups: Array<() => void> = [];
    let done = false;
    const collapse = () => {
      if (done) return;
      done = true;
      if (!useHouse && house && slot.house) setUseHouse(true);
      else setCollapsed(true);
    };
    const device = currentDevice();
    if (wrap === "anchor" && anchorClosed()) {
      setClosed(true);
      return;
    }
    if (wrap === "rail" && window.innerWidth < 1600) return;
    if (!devices.includes(device)) return;
    // Frequency cap: move to the next creative (e.g. the network fallback).
    if (showing && slot.cap > 0 && capReached(showing.id, slot.cap)) {
      const capped = new Set(list.filter((c) => capReached(c.id, slot.cap)).map((c) => c.id));
      const next = pickCreative(list, slot.rotation, Math.random(), capped);
      if (next) setCreative(next);
      else if (house && slot.house) setUseHouse(true);
      else setCollapsed(true);
      return;
    }
    const raf = requestAnimationFrame(() => {
      if (suppressedByRules(el, ads.rules)) return collapse();
      const dims = showing ? sizeOf(showing, device) : null;
      if (dims && dims.w > frame.clientWidth + 1) return collapse();
      const seenId = showing ? showing.id : "house";
      cleanups.push(trackImpression(el, id, seenId, () => noteCapView(seenId)));
      const code = showing?.code[device];
      if (!showing || !code?.html) return; // sponsor image / native card / house ad: already rendered
      if (ads.consent) {
        const choice = consentChoice();
        if (choice === "no") return collapse();
        if (choice !== "yes") return; // re-runs when the visitor answers (consentTick)
      }
      cleanups.push(
        whenNear(el, () => {
          if (showing.isolate) {
            const d = dims ?? { w: frame.clientWidth, h: 250 };
            frame.replaceChildren(isolatedFrame(code.html, d.w, d.h));
            return;
          }
          void injectHtml(frame, code.html).then(() => {
            cleanups.push(watchFill(frame, { onEmpty: collapse }));
          });
        }),
      );
    });
    cleanups.push(() => cancelAnimationFrame(raf));
    return () => cleanups.forEach((fn) => fn());
  }, [showing, useHouse, consentTick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (wrap !== "anchor") return;
    const active = !collapsed && !closed;
    document.documentElement.classList.toggle("has-ad-anchor", active);
    return () => document.documentElement.classList.remove("has-ad-anchor");
  }, [wrap, collapsed, closed]);

  if (closed) return null;
  const cls = ["ad-slot", `ad-slot--${id}`, ...DEVICES.filter((d) => !devices.includes(d)).map((d) => `ad-slot--no-${d}`), collapsed ? "is-collapsed" : ""].filter(Boolean).join(" ");
  const node = (
    <aside ref={asideRef} className={cls} data-slot={id} aria-label="Advertisement" data-leave-guard="off">
      <span className="ad-label">{slot.label}</span>
      <div ref={frameRef} className="ad-frame" style={frameVars(heights)}>
        {showing?.kind === "sponsor" ? <SponsorPicture c={showing} /> : null}
        {showing?.kind === "native" && !Object.values(showing.code).some((x) => x?.html) ? <NativeCard c={showing} /> : null}
        {!showing && house ? <HouseCard house={house} id={id} /> : null}
      </div>
      {wrap === "anchor" ? (
        <button
          type="button"
          className="ad-close"
          aria-label="Close advertisement"
          onClick={() => {
            closeAnchor();
            setClosed(true);
          }}
        >
          ×
        </button>
      ) : null}
    </aside>
  );
  return <>{wrapNode(wrap, id, occurrence, node, cellRef, wrap === "cell" ? true : undefined)}</>;
}

function srcset(b: { src: string; src2x: string | null }): string {
  return b.src2x ? `${b.src} 1x, ${b.src2x} 2x` : b.src;
}

function SponsorPicture({ c }: { c: PublicCreative }) {
  const d = c.banners.desktop ?? c.banners.tablet ?? c.banners.mobile;
  if (!d || !c.href) return null;
  return (
    <a className="ad-link" href={c.href} target="_blank" rel="sponsored noopener">
      <picture>
        {c.banners.mobile ? <source media="(max-width: 767px)" srcSet={srcset(c.banners.mobile)} width={c.banners.mobile.w} height={c.banners.mobile.h} /> : null}
        {c.banners.tablet ? <source media="(max-width: 1023px)" srcSet={srcset(c.banners.tablet)} width={c.banners.tablet.w} height={c.banners.tablet.h} /> : null}
        <img src={d.src} srcSet={d.src2x ? srcset(d) : undefined} width={d.w} height={d.h} alt={d.alt} loading="lazy" decoding="async" />
      </picture>
    </a>
  );
}

function NativeCard({ c }: { c: PublicCreative }) {
  if (!c.href) return null;
  return (
    <a className="ad-native" href={c.href} target="_blank" rel="sponsored noopener">
      {c.sponsorName ? <span className="ad-native__by">{c.sponsorName}</span> : null}
      <span className="ad-native__title">{c.nativeTitle}</span>
      {c.nativeText ? <span className="ad-native__text">{c.nativeText}</span> : null}
    </a>
  );
}

function HouseCard({ house, id }: { house: NonNullable<PublicAds["house"]>; id: SlotId }) {
  const external = /^https?:/.test(house.url);
  return (
    <a className="ad-native ad-house" href={`/ad-click/house?s=${id}`} {...(external ? { target: "_blank", rel: "noopener" } : {})}>
      <span className="ad-native__title">{house.title}</span>
      {house.text ? <span className="ad-native__text">{house.text}</span> : null}
      <span className="ad-native__cta">{house.cta}</span>
    </a>
  );
}

function PreviewBox({ id, wrap, occurrence }: { id: SlotId; wrap: Wrap; occurrence: number }) {
  const def = slotDef(id);
  const [device, setDevice] = useState<Device>("desktop");
  useEffect(() => setDevice(currentDevice()), []);
  if (!def) return null;
  const size = (def.sizes[device][0] ?? def.sizes.desktop[0] ?? "300x250") as AdSize;
  const dims = sizeDims(size);
  const node = (
    <aside className={`ad-slot ad-slot--${id} ad-slot--preview`} data-slot={id} data-preview="1" aria-label="Advertisement placement preview">
      <span className="ad-label">
        {id} · {def.devices.includes(device) ? size : `not on ${device}`} · {def.name}
      </span>
      <div className="ad-frame" style={{ height: dims ? dims.h : 120, width: dims ? Math.min(dims.w, 100000) : "100%" }} />
    </aside>
  );
  return <>{wrapNode(wrap === "cell" ? "li" : wrap, id, occurrence, node)}</>;
}

// ---------- root-level pieces ----------

function useAdPageType(): ReturnType<typeof pageTypeForPath> {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const notFound = useRouterState({ select: (s) => s.matches.some((m) => String(m.status) === "notFound" || (m as { globalNotFound?: boolean }).globalNotFound === true) });
  return notFound ? null : pageTypeForPath(pathname);
}

/** Client flags (?adpreview=1 for admins, ?noads=1), consent banner and global scripts. */
export function AdsRuntime() {
  const ads = useAds();
  const pageType = useAdPageType();
  const [askConsent, setAskConsent] = useState(false);
  const consentTick = useConsentTick();

  useEffect(() => {
    if (noAdsRequested()) noAdsStore.set(true);
    if (new URLSearchParams(window.location.search).get("adpreview") === "1") {
      void import("@/content/ads-api").then(({ adPreviewAllowed }) => adPreviewAllowed()).then((ok) => {
        if (ok) previewStore.set(true);
      }).catch(() => undefined);
    }
    return onConsentChange(() => consentStore.set(!consentStore.get()));
  }, []);

  useEffect(() => {
    setAskConsent(!!ads?.consent && consentChoice() === null && !noAdsStore.get());
  }, [ads?.consent, consentTick]);

  // Global head/body code for this page type; leaving to a page where loaded
  // code is not allowed reloads that page clean (e.g. no popunder on legal pages).
  useEffect(() => {
    if (!ads || noAdsStore.get()) return;
    const device = currentDevice();
    const allowed = new Set(ads.scripts.filter((s) => pageType && s.pages.includes(pageType) && s.devices.includes(device)).map((s) => s.id));
    const loaded = Array.from(document.querySelectorAll<HTMLElement>("[data-ad-global-item], [data-ad-global]")).map((n) => n.getAttribute("data-ad-global-item") ?? n.getAttribute("data-ad-global") ?? "");
    if (loaded.some((id) => id && !allowed.has(id))) {
      window.location.reload();
      return;
    }
    const consentOk = !ads.consent || consentChoice() === "yes";
    for (const s of ads.scripts) {
      if (!allowed.has(s.id)) continue;
      if (s.consent && !consentOk) continue;
      injectGlobal(s.code, s.placement, s.id);
    }
  }, [ads, pageType, consentTick]);

  if (!askConsent || !ads?.consent) return null;
  return (
    <div className="ad-consent" role="dialog" aria-live="polite" aria-label="Advertising cookies">
      <p>
        {ads.consent.text} <a href="/cookie-policy">Cookie policy</a>
      </p>
      <div className="ad-consent__actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setConsentChoice("no"); setAskConsent(false); }}>
          {ads.consent.reject}
        </button>
        <button type="button" className="btn btn--sm" onClick={() => { setConsentChoice("yes"); setAskConsent(false); }}>
          {ads.consent.accept}
        </button>
      </div>
    </div>
  );
}

/**
 * Head code rendered by the server on the first page load (verification tags,
 * a CMP, network loaders), so crawlers and CMPs see it in the HTML. Frozen
 * after hydration; later navigations are handled by AdsRuntime.
 */
export function AdHeadCode() {
  const ads = useAds();
  const pageType = useAdPageType();
  const [nodes] = useState(() => {
    if (!ads || !pageType) return [];
    return ads.scripts
      .filter((s) => s.placement === "head" && s.pages.includes(pageType) && s.devices.length === DEVICES.length && (!s.consent || !ads.consent))
      .flatMap((s) => parseHeadHtml(s.code).map((n, i) => ({ ...n, key: `${s.id}-${i}`, id: s.id })));
  });
  return (
    <>
      {nodes.map((n) => {
        const props: Record<string, unknown> = { key: n.key, ...reactProps(n.attrs), "data-ad-global-item": n.id };
        if (n.inner && (n.tag === "script" || n.tag === "style" || n.tag === "noscript")) props.dangerouslySetInnerHTML = { __html: n.inner };
        return createElement(n.tag, props);
      })}
    </>
  );
}

/** "Sponsored by …" under the byline of a sponsored article. */
export function SponsoredBy({ slug }: { slug: string }) {
  const ads = useAds();
  const name = ads?.sponsored[slug.toLowerCase()];
  if (!name) return null;
  return <p className="sponsored-by">Sponsored by {name}</p>;
}

export function useSponsoredArticle(slug: string): boolean {
  const ads = useAds();
  return !!ads?.sponsored[slug.toLowerCase()];
}
