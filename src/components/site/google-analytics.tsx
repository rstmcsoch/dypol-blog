import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useSite } from "./use-site";
import { useCmpHead } from "./cmp-head";

const COOKIE = "dypol-analytics-consent";
type Consent = "accept" | "reject" | null;

/**
 * t161: when a certified consent tool owns consent (its head code is set in
 * Admin → Ads), our own bar stays off and GA loads only once the tool grants
 * analytics_storage through Google Consent Mode.
 */
function watchCmpAnalytics(onGranted: () => void): () => void {
  const w = window as unknown as { dataLayer?: unknown[] };
  w.dataLayer ??= [];
  const dl = w.dataLayer;
  let granted = false;
  const check = (entry: unknown) => {
    if (granted || !entry || typeof entry !== "object") return;
    const a = Array.from(entry as ArrayLike<unknown>);
    const v = a[0] === "consent" && a[2] && typeof a[2] === "object" ? (a[2] as Record<string, unknown>).analytics_storage : undefined;
    if (v === "granted") { granted = true; onGranted(); }
  };
  dl.forEach(check);
  const push = dl.push;
  dl.push = function (...items: unknown[]) { items.forEach(check); return push.apply(this, items); };
  return () => { if (dl.push !== push) dl.push = push; };
}

/** No third-party request is made until a visitor has explicitly accepted. */
export function GoogleAnalytics() {
  const { analytics } = useSite();
  const path = useRouterState({ select: (state) => state.location.pathname + state.location.searchStr });
  const [consent, setConsent] = useState<Consent>(null);
  const [ready, setReady] = useState(false);
  const configured = useRef("");
  const lastPage = useRef("");
  const cmp = !!useCmpHead();
  useEffect(() => {
    if (cmp) {
      setReady(true);
      return watchCmpAnalytics(() => setConsent("accept"));
    }
    const value = document.cookie.split("; ").find((c) => c.startsWith(`${COOKIE}=`))?.split("=")[1];
    setConsent(value === "accept" || value === "reject" ? value : null);
    setReady(true);
  }, [cmp]);
  const id = analytics.measurementId;
  const allowed = consent === "accept" && analytics.enabled && /^G-[A-Z0-9]+$/.test(id);
  useEffect(() => {
    if (!allowed) return;
    const flags = window as unknown as Record<string, unknown>;
    flags[`ga-disable-${id}`] = false;
    window.dataLayer ??= [];
    window.gtag ??= function (...args: unknown[]) { window.dataLayer?.push(args); };
    if (configured.current !== id) {
      window.gtag("js", new Date());
      window.gtag("config", id, { send_page_view: false });
      configured.current = id;
    }
    if (!document.getElementById("consented-ga")) {
      const script = document.createElement("script");
      script.id = "consented-ga";
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
      document.head.append(script);
    }
    if (lastPage.current !== `${id}:${path}`) {
      window.gtag("event", "page_view", { send_to: id, page_path: path, page_location: window.location.href, page_title: document.title });
      lastPage.current = `${id}:${path}`;
    }
    return () => { flags[`ga-disable-${id}`] = true; };
  }, [allowed, id, path]);
  const choose = (choice: Consent) => {
    document.cookie = `${COOKIE}=${choice}; Path=/; Max-Age=15552000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    setConsent(choice);
  };
  if (!ready || cmp || consent || !analytics.enabled || !id) return null;
  return <section className="consent-bar" aria-label="Analytics cookie preferences">
    <p>{analytics.consentText}</p>
    <div className="inline-actions">
      <button className="btn" type="button" onClick={() => choose("accept")}>Accept</button>
      <button className="btn btn--ghost" type="button" onClick={() => choose("reject")}>Reject</button>
    </div>
  </section>;
}
