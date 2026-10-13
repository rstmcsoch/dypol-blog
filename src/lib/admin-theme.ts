/**
 * Desk (admin) appearance: Light, Dark or System. Stored in a cookie, not
 * localStorage, so the desk renders in the right palette on the very first
 * paint (no flash) and the choice survives reloads and devices' preferences.
 * The public site's own theme is untouched by this.
 */
export const DESK_THEME_COOKIE = "dypol_desk_theme";

export const deskThemes = ["light", "dark", "system"] as const;
export type DeskTheme = (typeof deskThemes)[number];

export function parseDeskTheme(value: string | null | undefined): DeskTheme | null {
  return value === "light" || value === "dark" || value === "system" ? value : null;
}

/** What the desk renders as when the choice is "system". */
export function deskThemeAttribute(theme: DeskTheme): "light" | "dark" | "system" {
  return theme;
}

export const DESK_THEME_LABELS: Record<DeskTheme, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};
