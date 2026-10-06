export const THEME_KEY = "dypol-theme";

export type ThemeChoice = "light" | "dark";

export const themeBootScript = `(function(){try{var s=localStorage.getItem("${THEME_KEY}");var t=s==="light"||s==="dark"?s:(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","light");}})();`;

export function readTheme(): ThemeChoice {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(next: ThemeChoice, persist: boolean) {
  document.documentElement.dataset.theme = next;
  if (!persist) return;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* private mode */
  }
}
