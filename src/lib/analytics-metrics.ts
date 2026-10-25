/**
 * t116: pure metric math for the Stats dashboard (no DB, no DOM — unit tested).
 *
 * Definitions (industry standard):
 * - Session: one reader (random first-party visitor id, 30-day cookie, no IP)
 *   on one Asia/Kolkata calendar day. Every metric uses the same IST date key.
 * - Engaged session (GA4): ≥10s engaged time, OR 2+ page views, OR a key event
 *   (an internal article-link click). Bounce rate = 100% − engagement rate.
 * - Avg engaged time (Chartbeat): total engaged time ÷ page views.
 * - Completion: reached ~90% scroll AND ≥15s engaged (fast scrolls don't count).
 * - Returning visitor (Chartbeat): visited on more than one day within 30 days.
 * - Recirculation (Parse.ly, per article): share of the article's views that
 *   were followed by a click to another article.
 */

export const ENGAGED_SECONDS = 10;
export const COMPLETION_MIN_SECONDS = 15;
export const INSIGHT_MIN_SESSIONS = 20;
export const RETURNING_WINDOW_DAYS = 30;

export type ReadRow = {
  session_id: string;
  date: string;
  article_id: string;
  page_views: number;
  engaged_seconds: number;
  completed: number;
  key_events?: number | null;
  max_scroll?: number | null;
};

export type SessionAgg = {
  visitor: string;
  date: string;
  pageViews: number;
  engagedSeconds: number;
  keyEvents: number;
  articles: number;
};

/** Group article reads into sessions (visitor × IST day). */
export function sessionsFromReads(rows: ReadRow[]): SessionAgg[] {
  const map = new Map<string, SessionAgg>();
  for (const r of rows) {
    const key = `${r.session_id}|${r.date}`;
    let s = map.get(key);
    if (!s) {
      s = { visitor: r.session_id, date: r.date, pageViews: 0, engagedSeconds: 0, keyEvents: 0, articles: 0 };
      map.set(key, s);
    }
    s.pageViews += Number(r.page_views ?? 0);
    s.engagedSeconds += Number(r.engaged_seconds ?? 0);
    s.keyEvents += Number(r.key_events ?? 0);
    s.articles += 1;
  }
  return Array.from(map.values());
}

export function isEngagedSession(s: { pageViews: number; engagedSeconds: number; keyEvents: number }): boolean {
  return s.engagedSeconds >= ENGAGED_SECONDS || s.pageViews >= 2 || s.keyEvents > 0;
}

/** A single article read (one article in one session) counts as engaged on the same rule. */
export function isEngagedRead(r: ReadRow): boolean {
  return isEngagedSession({ pageViews: Number(r.page_views ?? 0), engagedSeconds: Number(r.engaged_seconds ?? 0), keyEvents: Number(r.key_events ?? 0) });
}

export function completionQualifies(r: Pick<ReadRow, "completed" | "engaged_seconds">): boolean {
  return Number(r.completed ?? 0) > 0 && Number(r.engaged_seconds ?? 0) >= COMPLETION_MIN_SECONDS;
}

export type Summary = {
  sessions: number;
  engagedSessions: number;
  pageViews: number;
  engagedSeconds: number;
  engagementRate: number | null; // %
  bounceRate: number | null; // % = 100 − engagement
  avgEngagedTime: number | null; // seconds per page view
  pagesPerSession: number | null;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export function summarize(sessions: SessionAgg[]): Summary {
  let engaged = 0;
  let pv = 0;
  let secs = 0;
  for (const s of sessions) {
    if (isEngagedSession(s)) engaged += 1;
    pv += s.pageViews;
    secs += s.engagedSeconds;
  }
  const n = sessions.length;
  const engagementRate = n > 0 ? round1((engaged / n) * 100) : null;
  return {
    sessions: n,
    engagedSessions: engaged,
    pageViews: pv,
    engagedSeconds: round1(secs),
    engagementRate,
    bounceRate: engagementRate === null ? null : round1(100 - engagementRate),
    avgEngagedTime: pv > 0 ? round1(secs / pv) : null,
    pagesPerSession: n > 0 ? Math.round((pv / n) * 100) / 100 : null,
  };
}

/** Growth between periods. 0→0 = "—", x→0 = −100%, 0→x = "New". */
export function growth(current: number, previous: number): { value: number | null; label: string; rank: number } {
  if (previous === 0 && current === 0) return { value: null, label: "—", rank: -1e9 };
  if (previous === 0) return { value: null, label: "New", rank: 1e9 };
  const value = round1(((current - previous) / previous) * 100);
  return { value, label: `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value)}%`, rank: value };
}

/** Delta for overview cards: null when there is no prior data at all. */
export function deltaPercent(current: number | null, previous: number | null, priorHasData: boolean): number | null {
  if (!priorHasData || current === null || previous === null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** New vs returning visitors in [from, to]; `visitDates` covers [from − 29 days, to]. */
export function classifyVisitors(
  periodVisitors: Iterable<string>,
  visitDates: Map<string, Set<string>>,
): { users: number; newUsers: number; returningUsers: number } {
  let users = 0;
  let returning = 0;
  for (const v of periodVisitors) {
    users += 1;
    if ((visitDates.get(v)?.size ?? 0) > 1) returning += 1;
  }
  return { users, newUsers: users - returning, returningUsers: returning };
}

/** Short axis date: "2026-10-20" → "20 Oct". */
export function shortDate(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  if (!y || !m || !d) return yyyymmdd;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[m - 1]}`;
}

export type AlignedPoint = { day: number; date: string; label: string; current: number; previous: number | null; previousDate: string | null };

/** Align previous-period values to the current period's axis by day index. */
export function alignSeries(
  current: Array<{ date: string; value: number }>,
  previous: Array<{ date: string; value: number }> | null,
): AlignedPoint[] {
  return current.map((p, i) => ({
    day: i,
    date: p.date,
    label: shortDate(p.date),
    current: p.value,
    previous: previous && previous[i] ? previous[i].value : null,
    previousDate: previous && previous[i] ? previous[i].date : null,
  }));
}

/** A y-axis max that always contains the data (never clips the line). */
export function niceMax(values: number[]): number {
  const max = Math.max(0, ...values.filter((v) => Number.isFinite(v)));
  if (max <= 0) return 1;
  if (max <= 5) return Math.ceil(max) + 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const steps = [1, 2, 2.5, 5, 10];
  for (const s of steps) {
    const candidate = s * pow;
    if (candidate >= max * 1.1) return candidate;
  }
  return 10 * pow;
}

/** Integer, evenly spaced, de-duplicated y-axis ticks from 0 to a top that contains the data. */
export function niceTicks(values: number[], maxTicks = 5): number[] {
  const max = Math.max(0, ...values.filter((v) => Number.isFinite(v)));
  if (max <= 0) return [0, 1];
  const raw = max / (maxTicks - 1);
  const pow = 10 ** Math.floor(Math.log10(raw));
  let step = Math.max(1, [1, 2, 5, 10].map((m) => m * pow).find((c) => c >= raw) ?? 10 * pow);
  step = Math.ceil(step);
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return [...new Set(ticks)];
}

/** Per-article recirculation: share of views followed by an internal click (capped at 100%). */
export function articleRecirculation(views: number, clicks: number): number | null {
  if (views <= 0) return null;
  return round1((Math.min(clicks, views) / views) * 100);
}

/** Insights only with a big enough sample. */
export function insightsAllowed(sessions: number): boolean {
  return sessions >= INSIGHT_MIN_SESSIONS;
}

/** Scroll-depth funnel from per-read max scroll (0..100). */
export function scrollFunnel(maxScrolls: number[]): Array<{ depth: number; reads: number; share: number | null }> {
  const n = maxScrolls.length;
  return [25, 50, 75, 100].map((depth) => {
    const reads = maxScrolls.filter((s) => (depth === 100 ? s >= 99 : s >= depth)).length;
    return { depth, reads, share: n > 0 ? round1((reads / n) * 100) : null };
  });
}
