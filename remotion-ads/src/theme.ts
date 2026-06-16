import { loadFont as loadGeist } from "@remotion/google-fonts/Geist";
import { loadFont as loadGeistMono } from "@remotion/google-fonts/GeistMono";

const geist = loadGeist("normal", {
  weights: ["400", "500", "600"],
  subsets: ["latin"],
  ignoreTooManyRequestsWarning: true,
});
const geistMono = loadGeistMono("normal", {
  weights: ["500"],
  subsets: ["latin"],
  ignoreTooManyRequestsWarning: true,
});

export const fonts = {
  sans: `${geist.fontFamily}, system-ui, -apple-system, "Segoe UI", sans-serif`,
  mono: `${geistMono.fontFamily}, ui-monospace, "JetBrains Mono", monospace`,
};

/**
 * Pulled 1:1 from src/app/globals.css (@theme block). Rendered in Chromium,
 * which supports oklch() natively, so we keep the source-of-truth values.
 */
export const colors = {
  brand50: "oklch(0.970 0.020 250)",
  brand100: "oklch(0.930 0.050 250)",
  brand200: "oklch(0.860 0.100 250)",
  brand300: "oklch(0.760 0.150 250)",
  brand400: "oklch(0.660 0.190 250)",
  brand500: "oklch(0.560 0.215 250)", // primary cobalt
  brand600: "oklch(0.475 0.220 250)",
  brand700: "oklch(0.395 0.190 250)",
  brand800: "oklch(0.310 0.150 250)",
  brand900: "oklch(0.215 0.090 250)",
  brand950: "oklch(0.135 0.055 250)",

  amber400: "oklch(0.830 0.140 75)", // warm accent
  amber500: "oklch(0.780 0.150 75)",

  bg: "oklch(0.992 0.005 250)",
  surface: "oklch(1 0 0)",
  foreground: "oklch(0.180 0.022 250)",
  muted: "oklch(0.555 0.018 250)",
  border: "oklch(0.880 0.008 250)",

  // dark canvas used for the cinematic intro / CTA backdrops
  ink: "oklch(0.135 0.030 255)",
  ink2: "oklch(0.108 0.018 250)",
} as const;

export const accent = colors.brand500;
export const accentFg = "oklch(1 0 0)";
