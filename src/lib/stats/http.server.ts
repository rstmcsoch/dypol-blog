import { hasDeskSessionCookie } from "./classify";

type Limiter = { limit(input: { key: string }): Promise<{ success: boolean }> };

const NONE = new Response(null, { status: 204, headers: { "cache-control": "no-store" } });

export function isLikelyBot(ua: string): boolean {
  return /bot|crawl|spider|slurp|facebookexternalhit|preview/i.test(ua);
}

/**
 * Shared gate for the public counters. Returns a Response when the request
 * must be ignored, or null when the caller should record it.
 * Invalid payloads are the caller's job (400). Bots, other origins, signed-in
 * admin browsers and rate-limit hits are silent 204s so they never throw on
 * a leaving page.
 */
export async function publicStatGate(request: Request, limitKey: string): Promise<Response | null> {
  const origin = request.headers.get("origin");
  let expected = "";
  try {
    expected = new URL(request.url).origin;
  } catch {
    return NONE;
  }
  if (origin && origin !== expected) return new Response(null, { status: 403, headers: { "cache-control": "no-store" } });
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!origin && fetchSite !== "same-origin" && fetchSite !== "none") return NONE;
  if (isLikelyBot(request.headers.get("user-agent") ?? "")) return NONE;
  if (hasDeskSessionCookie(request.headers.get("cookie"))) return NONE;
  const { writesAllowed } = await import("@/lib/write-guard.server");
  if (!(await writesAllowed())) return NONE;
  const { workerEnv } = await import("@/lib/cf-env.server");
  const env = (await workerEnv()) as { MCP_LIMITER?: Limiter };
  if (env.MCP_LIMITER) {
    const { success } = await env.MCP_LIMITER.limit({ key: limitKey });
    if (!success) return NONE;
  }
  return null;
}

export function noContent(): Response {
  return NONE;
}

export function clientAddress(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "local";
}
