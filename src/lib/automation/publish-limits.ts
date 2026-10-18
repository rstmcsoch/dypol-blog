/**
 * Two-tier AI publish limits (t64).
 *
 * 1) Website daily cap (Settings -> "Maximum AI-published articles per
 *    day (whole website)"): total AI/MCP publishes across ALL profiles
 *    per UTC day, counting automatic AND explicit publishes. Admin
 *    manual publishing never creates automation run rows, so it is
 *    never counted or blocked. 0 = no limit.
 * 2) Per-run cap (Automation tab -> "Maximum articles per run"): one
 *    automation execution may publish at most N articles, on either
 *    publish path. 0 = no limit.
 *
 * What is a "run" for stateless MCP calls?
 *  - Primary: the AI passes one `run_id` per execution (additive,
 *    optional tool field). Publishes are counted per (profile, run_id).
 *  - Fallback (current prompts without run_id): publishes from one
 *    profile with no gap longer than BURST_GAP_MS between consecutive
 *    publishes form one "burst" and are counted together. A new burst
 *    starts after BURST_GAP_MS of publish silence.
 */

export const BURST_GAP_MS = 30 * 60 * 1000;

export type PublishUsage = {
  /** ISO timestamp of the publish (or in-flight claim). */
  createdAt: string;
  /** Effective run key stamped on the run row, when present. */
  runKey: string | null;
  profileId: string;
};

export type EffectiveRun = {
  runKey: string;
  source: "run_id" | "burst";
  /** Publishes already counted in this run (claims included by caller). */
  used: number;
};

export function sanitizeRunId(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const clean = raw.trim().replace(/[^A-Za-z0-9_.:-]/g, "-").slice(0, 80);
  return clean.length >= 4 ? clean : null;
}

/**
 * Work out the effective run for a profile. `usage` is today's publish
 * usage for that profile (any order); claims are included by the
 * caller so concurrent in-flight publishes count too.
 */
export function effectiveRun(profileId: string, runId: string | undefined | null, usage: PublishUsage[], now = new Date()): EffectiveRun {
  const clean = sanitizeRunId(runId);
  if (clean) {
    const runKey = `run:${profileId}:${clean}`;
    return { runKey, source: "run_id", used: usage.filter((u) => u.runKey === runKey).length };
  }
  const sorted = [...usage].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latest = sorted[0];
  if (!latest || now.getTime() - new Date(latest.createdAt).getTime() > BURST_GAP_MS) {
    return { runKey: `burst:${profileId}:${now.toISOString()}`, source: "burst", used: 0 };
  }
  // Walk the burst chain backwards while gaps stay within BURST_GAP_MS.
  let count = 0;
  let earliest = latest.createdAt;
  let previous = new Date(latest.createdAt).getTime();
  for (const row of sorted) {
    const at = new Date(row.createdAt).getTime();
    if (count > 0 && previous - at > BURST_GAP_MS) break;
    count += 1;
    earliest = row.createdAt;
    previous = at;
  }
  const stamped = usage.filter((u) => u.runKey === `burst:${profileId}:${earliest}`).length;
  return { runKey: `burst:${profileId}:${earliest}`, source: "burst", used: Math.max(count, stamped) };
}

export type LimitVerdict = {
  blocked: boolean;
  /** Set when the website daily cap is the (first) blocker. */
  websiteReason: string | null;
  /** Set when the per-run cap is the (first) blocker. */
  runReason: string | null;
};

export function limitVerdict(input: {
  websiteUsed: number;
  websiteCap: number;
  runUsed: number;
  runCap: number;
}): LimitVerdict {
  const websiteReason =
    input.websiteCap > 0 && input.websiteUsed >= input.websiteCap
      ? `Website daily publish limit reached (${input.websiteCap}).`
      : null;
  const runReason =
    !websiteReason && input.runCap > 0 && input.runUsed >= input.runCap
      ? `Per-run publish limit reached (${input.runCap}) for this automation run.`
      : null;
  return { blocked: Boolean(websiteReason ?? runReason), websiteReason, runReason };
}
