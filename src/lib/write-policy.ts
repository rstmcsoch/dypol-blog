/** Pure write/CSRF policy, shared by the server guard and node tests. */
export function isVersionPreviewHost(host: string): boolean {
  return /^[0-9a-f]{8}-[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/i.test(host);
}

export function writesAllowedFor(input: { env?: string; writes?: string; host: string }): boolean {
  if ((input.writes ?? "").toLowerCase() === "off") return false;
  if (input.env === "preview") return true;
  return !isVersionPreviewHost(input.host);
}

/** Rejects cross-site POSTs even if a browser were to send the cookie. */
export function sameOriginRequest(request: { url: string; headers: { get(name: string): string | null } }): boolean {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

