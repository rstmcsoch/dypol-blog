/**
 * t177: the website daily cap (Settings → AI publishing limit) is ONE global
 * hard cap across Normal + Special AI publishes. Shown on both automation tabs.
 */
import { Link } from "@tanstack/react-router";

export type PublishUsageView = { websiteCap: number; used: number; specialUsed: number; normalUsed: number };

export function CombinedLimitNote({ usage, tab }: { usage: PublishUsageView; tab: "normal" | "special" }) {
  const own = tab === "normal" ? "this tab's per-run limit" : "this tab's limits (weekly and daily)";
  const full = usage.websiteCap > 0 && usage.used >= usage.websiteCap;
  return (
    <div className={`sp-limit${full ? " is-full" : ""}`} role="note" data-testid={`combined-limit-${tab}`}>
      <p className="sp-limit__usage">
        <strong>{usage.websiteCap > 0 ? `${usage.used} of ${usage.websiteCap} today` : `${usage.used} today (no main limit)`}</strong>
        <span> AI-published, Normal {usage.normalUsed} · Special {usage.specialUsed} (UTC day)</span>
      </p>
      {usage.websiteCap > 0 ? (
        <meter className="sp-limit__meter" min={0} max={usage.websiteCap} value={Math.min(usage.used, usage.websiteCap)} aria-label="Today's combined AI publishes" />
      ) : null}
      <p className="desk-note">
        The main limit in <Link to="/admin/settings">Settings → AI publishing limit</Link> overrides {own}: it counts Normal + Special
        AI publishes together, and an article goes live only if it passes both. Anything over a limit stays a draft, with the reason in
        the run log. Publishing or scheduling manually in the admin panel is never counted or blocked.
      </p>
    </div>
  );
}
