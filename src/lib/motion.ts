import { useEffect, useState } from "react";
import { prefersReducedMotion } from "@/lib/smooth-scroll";

/** t220: keep in sync with `--motion` / `--motion-exit` in styles.css. */
export const MOTION_MS = 180;
export const MOTION_EXIT_MS = 140;

/**
 * Keep a departing node mounted until its exit animation finishes, then drop it.
 * Timers are cleared on change or unmount. Reduced motion unmounts immediately.
 */
export function usePresence(
  open: boolean,
  exitMs: number = MOTION_EXIT_MS,
): { shown: boolean; leaving: boolean } {
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) {
      setShown(true);
      return;
    }
    if (!shown) return;
    const ms = prefersReducedMotion() ? 0 : exitMs;
    const timer = window.setTimeout(() => setShown(false), ms);
    return () => window.clearTimeout(timer);
  }, [open, exitMs, shown]);
  return { shown, leaving: shown && !open };
}
