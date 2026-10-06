import { useLayoutEffect } from "react";
import { THEME_KEY, applyTheme } from "./theme";

/** Re-apply the boot script's choice after hydration, in case the attribute was reset. */
export function ThemeSync() {
  useLayoutEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(THEME_KEY);
    } catch {
      stored = null;
    }
    if (stored === "light" || stored === "dark") {
      applyTheme(stored, false);
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(THEME_KEY);
      } catch {
        stored = null;
      }
      if (stored === "light" || stored === "dark") return;
      applyTheme(media.matches ? "dark" : "light", false);
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return null;
}
