import { Moon, Sun } from "lucide-react";
import { useLayoutEffect, useState } from "react";
import { site } from "@/content/site";
import { applyTheme, readTheme, type ThemeChoice } from "./theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeChoice | null>(null);

  useLayoutEffect(() => {
    setTheme(readTheme());
  }, []);

  function choose(next: ThemeChoice) {
    applyTheme(next, true);
    setTheme(next);
  }

  return (
    <div className="theme-switch" role="group" aria-label={site.labels.themeGroup}>
      <button
        type="button"
        className="theme-switch__btn"
        data-value="light"
        aria-label={site.labels.dayTheme}
        aria-pressed={theme === null ? undefined : theme === "light"}
        onClick={() => choose("light")}
      >
        <Sun aria-hidden="true" strokeWidth={2.25} />
        <span className="theme-switch__label">{site.labels.day}</span>
        <span className="theme-switch__mark" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="theme-switch__btn"
        data-value="dark"
        aria-label={site.labels.nightTheme}
        aria-pressed={theme === null ? undefined : theme === "dark"}
        onClick={() => choose("dark")}
      >
        <Moon aria-hidden="true" strokeWidth={2.25} />
        <span className="theme-switch__label">{site.labels.night}</span>
        <span className="theme-switch__mark" aria-hidden="true" />
      </button>
    </div>
  );
}
