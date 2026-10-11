/**
 * Sign-in rate limiting (pure policy; the Worker passes in the binding).
 *
 * Uses the Workers Rate Limiting binding SIGNIN_LIMITER (wrangler.jsonc
 * "ratelimits"): 5 attempts per 60 s per client IP (CF-Connecting-IP). Counters
 * live in Cloudflare's rate-limit service, not in the isolate, so they are shared
 * by every isolate of the Worker in a Cloudflare location and survive restarts.
 * Every attempt counts, right or wrong, so the limiter never reveals whether a
 * token was valid.
 */
export const SIGNIN_LIMIT = 5;
export const SIGNIN_PERIOD_SECONDS = 60;

export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export function clientKey(headers: { get(name: string): string | null }): string {
  const ip = headers.get("cf-connecting-ip") ?? headers.get("x-real-ip") ?? "";
  return `signin:${ip.trim().slice(0, 64) || "unknown"}`;
}

export type LimitDecision = { allowed: true } | { allowed: false; retryAfter: number };

export async function checkSignIn(limiter: RateLimitBinding | undefined, key: string): Promise<LimitDecision> {
  if (!limiter || typeof limiter.limit !== "function") {
    // Misconfiguration: fail closed so the desk can't be brute-forced unthrottled.
    return { allowed: false, retryAfter: SIGNIN_PERIOD_SECONDS };
  }
  const { success } = await limiter.limit({ key });
  return success ? { allowed: true } : { allowed: false, retryAfter: SIGNIN_PERIOD_SECONDS };
}
