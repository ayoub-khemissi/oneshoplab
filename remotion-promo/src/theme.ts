import { loadFont as loadGeist } from "@remotion/google-fonts/Geist";
import { loadFont as loadGeistMono } from "@remotion/google-fonts/GeistMono";

const geist = loadGeist("normal", {
  weights: ["200", "300", "400", "500", "600", "700"],
  subsets: ["latin"],
  ignoreTooManyRequestsWarning: true,
});
const geistMono = loadGeistMono("normal", {
  weights: ["400", "500", "600"],
  subsets: ["latin"],
  ignoreTooManyRequestsWarning: true,
});

export const fonts = {
  sans: `${geist.fontFamily}, system-ui, "Segoe UI", sans-serif`,
  mono: `${geistMono.fontFamily}, ui-monospace, monospace`,
};

/** 1:1 with src/app/globals.css (@theme + :root tokens). Chromium renders oklch natively. */
export const c = {
  brand50: "oklch(0.97 0.02 250)",
  brand100: "oklch(0.93 0.05 250)",
  brand200: "oklch(0.86 0.1 250)",
  brand300: "oklch(0.76 0.15 250)",
  brand400: "oklch(0.66 0.19 250)",
  brand500: "oklch(0.56 0.215 250)",
  brand600: "oklch(0.475 0.22 250)",
  brand700: "oklch(0.395 0.19 250)",
  brand800: "oklch(0.31 0.15 250)",
  brand900: "oklch(0.215 0.09 250)",
  brand950: "oklch(0.135 0.055 250)",

  snow: "oklch(0.99 0.002 250)",
  eclipse: "oklch(0.18 0.022 250)",
  bg: "oklch(0.992 0.005 250)",
  surface: "oklch(1 0 0)",
  default: "oklch(0.96 0.005 250)",
  muted: "oklch(0.555 0.018 250)",
  border: "oklch(0.91 0.008 250)",
  fieldBorder: "oklch(0.88 0.008 250)",
  success: "oklch(0.7 0.16 150)",
  warning: "oklch(0.78 0.16 70)",
  danger: "oklch(0.62 0.22 25)",

  // dark mode canvas (globals.css .dark)
  night: "oklch(0.108 0.018 250)",
  night2: "oklch(0.145 0.025 252)",
  nightFg: "oklch(0.96 0.005 250)",

  // dawn — warm accent used by the site's amber highlights
  amber300: "oklch(0.88 0.1 75)",
  amber400: "oklch(0.83 0.14 75)",
};

export const mix = (color: string, pct: number, other = "transparent") =>
  `color-mix(in oklch, ${color} ${pct}%, ${other})`;

export const scoreColor = (score: number) =>
  score >= 75 ? c.success : score >= 50 ? c.warning : c.danger;
