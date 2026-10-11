import type { Appearance } from "@/content/types";

/**
 * Turns the owner's appearance settings into CSS variables for the public site.
 * Pure (no DOM), so the admin live preview and tests use the same math.
 * Text colors are picked so body text keeps >= 7:1 and secondary text >= 4.5:1
 * contrast (WCAG AA) at every allowed slider position.
 */

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function grey(lightnessPercent: number): string {
  const v = Math.round((clamp(lightnessPercent, 0, 100) / 100) * 255);
  const h = v.toString(16).padStart(2, "0");
  return `#${h}${h}${h}`;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Lightest (on dark) or darkest (on light) grey still close to `preferred` that meets `min` contrast. */
function readableGrey(bg: string, preferred: number, min: number, onDark: boolean): string {
  let l = preferred;
  for (let i = 0; i < 101 && contrast(grey(l), bg) < min; i += 1) l = onDark ? l + 1 : l - 1;
  return grey(clamp(l, 0, 100));
}

export type ThemeColors = { paper: string; ink: string; muted: string };

export function themeColors(a: Pick<Appearance, "darkness" | "whiteness">): { light: ThemeColors; dark: ThemeColors } {
  const lightPaper = grey(clamp(a.whiteness, 85, 100));
  const darkPaper = grey(100 - clamp(a.darkness, 75, 100));
  return {
    light: { paper: lightPaper, ink: readableGrey(lightPaper, 7, 7, false), muted: readableGrey(lightPaper, 29, 4.5, false) },
    dark: { paper: darkPaper, ink: readableGrey(darkPaper, 96, 7, true), muted: readableGrey(darkPaper, 71, 4.5, true) },
  };
}

/** Text color on the accent: near-black or white, whichever reads better. */
export function accentInk(accent: string): string {
  return contrast("#111111", accent) >= contrast("#ffffff", accent) ? "#111111" : "#ffffff";
}

/** CSS that overrides the theme variables. Inputs are validated hex/number values only. */
export function appearanceCss(a: Appearance): string {
  const { light, dark } = themeColors(a);
  const accent = /^#[0-9a-f]{6}$/i.test(a.accent) ? a.accent.toLowerCase() : "#ff4d00";
  const vars = (c: ThemeColors) => `--paper:${c.paper};--ink:${c.ink};--muted:${c.muted};`;
  const ink = accentInk(accent);
  return [
    `:root{--accent:${accent};--accent-ink:${ink};--swatch-day:${light.paper};--swatch-day-ink:${light.ink};--swatch-night:${dark.paper};--swatch-night-ink:${dark.ink};${vars(light)}}`,
    `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${vars(dark)}}}`,
    `:root[data-theme="light"]{${vars(light)}}`,
    `:root[data-theme="dark"]{${vars(dark)}}`,
  ].join("\n");
}
