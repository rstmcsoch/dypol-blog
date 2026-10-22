/** Coarse acquisition fields. The server keeps a host or a channel, never the full referrer URL. */
export function readAcquisition() {
  let refHost = "";
  let inboundArticle = false;
  if (typeof document !== "undefined" && document.referrer) {
    try {
      const ref = new URL(document.referrer);
      refHost = ref.host;
      const path = location.pathname.replace(/\/$/, "") || "/";
      const refPath = ref.pathname.replace(/\/$/, "") || "/";
      inboundArticle = ref.host === location.host && /^\/articles\/[^/]+$/.test(refPath) && refPath !== path;
    } catch {
      refHost = "";
    }
  }
  const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
  return {
    refHost,
    inboundArticle,
    utmSource: params.get("utm_source") ?? "",
    utmMedium: params.get("utm_medium") ?? "",
    utmCampaign: params.get("utm_campaign") ?? "",
  };
}

export function postJson(url: string, payload: unknown): void {
  const body = JSON.stringify(payload);
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(url, blob)) return;
    }
  } catch {
    /* fetch below */
  }
  void fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}
