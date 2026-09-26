import React from "react";
import { AbsoluteFill, Img, interpolate, random, staticFile } from "remotion";
import { c, fonts, mix, scoreColor } from "../theme";

/* ---------- Icons (lucide paths — the app's icon set) ---------- */

const ICONS = {
  check: ["M20 6 9 17l-5-5"],
  arrowRight: ["M5 12h14", "m12 5 7 7-7 7"],
  sparkles: [
    "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z",
    "M20 3v4",
    "M22 5h-4",
    "M4 17v2",
    "M5 18H3",
  ],
  bag: ["M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z", "M3 6h18", "M16 10a4 4 0 0 1-8 0"],
  moon: ["M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"],
  heart: [
    "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z",
  ],
  pencil: [
    "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
    "m15 5 4 4",
  ],
  layers: [
    "m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z",
    "m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65",
    "m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65",
  ],
  sync: [
    "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",
    "M21 3v5h-5",
    "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",
    "M8 16H3v5",
  ],
  undo: ["M9 14 4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"],
  image: ["M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z", "M21 15l-5-5L5 21", "M9 9h.01"],
  alert: ["M12 9v4", "M12 17h.01", "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"],
  plug: ["M12 22v-5", "M9 8V2", "M15 8V2", "M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"],
} as const;

export type IconName = keyof typeof ICONS;

export const Icon: React.FC<{ name: IconName; size?: number; color?: string; stroke?: number; style?: React.CSSProperties }> = ({
  name,
  size = 24,
  color = "currentColor",
  stroke = 2,
  style,
}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, ...style }}>
    {ICONS[name].map((d) => (
      <path key={d} d={d} />
    ))}
  </svg>
);

/* ---------- Logo (inlined public/osl-dark.svg) ---------- */

export const LOGO_PATHS = [
  "M81.2044 113.274C102.747 92.9353 131.34 80.2313 160.84 77.7359C192.504 74.8129 225.136 84.0791 250.553 103.187C291.736 132.967 312.851 188.32 300.566 237.827C300.103 239.327 300.121 241.107 299.074 242.364C297.651 238.551 294.528 235.82 291.753 232.993C282.862 223.84 270.437 218.134 257.681 217.54C246.094 216.415 233.399 218.893 224.665 227.042C213.296 237.582 211.481 256.638 220.564 269.185C227.3 278.861 238.468 283.678 248.485 289.149C262.393 296.748 277.086 303.109 289.991 312.401C301.63 320.655 310.251 333.377 312.249 347.634C314.596 361.612 311.751 376.479 303.873 388.328C297.407 397.49 288.193 404.81 277.54 408.466C266.179 412.768 253.781 413.178 241.819 412.026C224.351 409.522 207.485 401.163 196.02 387.595C201.063 383.425 205.967 379.071 210.853 374.717C219.552 384.385 231.732 390.763 244.646 392.316C257.018 393.974 270.577 392.089 280.681 384.289C294.449 373.495 297.407 351.473 286.841 337.495C278.866 326.798 266.153 321.528 254.88 315.158C247.132 311.319 239.602 307.044 231.95 303.022C223.19 298.197 214.378 292.996 207.59 285.519C190.942 266.681 190.828 235.645 207.162 216.581C215.905 206.311 228.67 199.898 241.958 198.057C252.167 196.609 263.1 197.001 272.453 201.748C277.226 204.016 281.466 207.41 284.503 211.764C285.384 181.941 273.57 152.023 252.629 130.785C230.109 107.637 197.329 94.881 165.071 97.1495C131.907 98.9818 99.9986 116.319 80.4453 143.166C60.4645 170.206 53.5017 206.494 62.4713 238.943C66.4587 254.09 73.8316 268.269 83.4817 280.572C102.136 303.868 130.205 319.6 159.976 322.592C178.866 324.73 198.341 321.868 215.765 314.234C222.292 318.343 229.054 322.034 235.72 325.899C201.813 345.688 158.719 347.93 122.483 333.228C97.887 323.439 76.6149 305.866 61.9478 283.861C43.459 256.464 35.5277 221.99 40.8327 189.306C45.5094 160.469 59.7839 133.194 81.2044 113.274Z",
  "M334.236 189.725C340.815 189.411 347.402 189.621 353.99 189.568C353.902 255.898 353.937 322.218 354.007 388.548C389.301 388.373 424.603 388.548 459.905 388.46C459.967 394.943 459.888 401.417 459.923 407.9C417.998 408.022 376.073 407.918 334.157 407.944C334.41 374.081 334.166 340.218 334.262 306.356C334.21 267.476 334.332 228.605 334.236 189.725Z",
];

export const LogoMark: React.FC<{ size?: number; fill?: string; style?: React.CSSProperties }> = ({ size = 64, fill = "currentColor", style }) => (
  <svg width={size} height={size} viewBox="0 0 500 500" fill="none" style={style}>
    {LOGO_PATHS.map((d) => (
      <path key={d.slice(0, 12)} d={d} fill={fill} />
    ))}
  </svg>
);

/* ---------- Pointer ---------- */

export const Cursor: React.FC<{ x: number; y: number; click?: number; size?: number; opacity?: number }> = ({ x, y, click = 0, size = 56, opacity = 1 }) => {
  const dip = interpolate(click, [0, 0.35, 1], [1, 0.82, 1]);
  const r = interpolate(click, [0, 1], [0.3, 2.8]);
  const ro = interpolate(click, [0, 0.1, 1], [0, 0.55, 0]);
  return (
    <div style={{ position: "absolute", left: x, top: y, zIndex: 50, opacity }}>
      <div
        style={{
          position: "absolute",
          width: size,
          height: size,
          borderRadius: 999,
          border: `4px solid ${c.brand500}`,
          transform: `translate(-50%, -50%) scale(${r})`,
          opacity: ro,
        }}
      />
      <svg width={size} height={size} viewBox="0 0 24 24" style={{ transform: `scale(${dip})`, transformOrigin: "10% 10%", filter: "drop-shadow(0 6px 10px rgba(10,20,40,0.35))" }}>
        <path d="M5 3l14 8.5-6.2 1.3L9.5 19 5 3z" fill="white" stroke={c.eclipse} strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
    </div>
  );
};

/* ---------- Film grain ---------- */

export const Grain: React.FC<{ f: number; opacity: number }> = ({ f, opacity }) => {
  const seed = Math.floor(f / 2) % 12;
  return (
    <AbsoluteFill style={{ opacity, mixBlendMode: "overlay", pointerEvents: "none" }}>
      <svg width="100%" height="100%">
        <filter id={`grain-${seed}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={seed} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#grain-${seed})`} />
      </svg>
    </AbsoluteFill>
  );
};

/* ---------- App primitives (mirroring the site's cards / chips) ---------- */

export const Eyebrow: React.FC<{ children: React.ReactNode; color?: string; dot?: boolean; size?: number }> = ({ children, color = c.muted, dot = true, size = 24 }) => (
  <div style={{ display: "flex", alignItems: "center", gap: size * 0.5, fontFamily: fonts.mono, fontSize: size, fontWeight: 500, letterSpacing: "0.16em", textTransform: "uppercase", color }}>
    {dot ? <span style={{ width: size * 0.36, height: size * 0.36, borderRadius: 99, background: c.brand500, boxShadow: `0 0 ${size * 0.5}px ${c.brand500}` }} /> : null}
    {children}
  </div>
);

export const ScoreBadge: React.FC<{ score: number; size?: number; style?: React.CSSProperties }> = ({ score, size = 26, style }) => {
  const col = scoreColor(score);
  return (
    <span
      style={{
        fontFamily: fonts.mono,
        fontWeight: 600,
        fontSize: size,
        padding: `${size * 0.22}px ${size * 0.55}px`,
        borderRadius: 999,
        color: col,
        background: mix(col, 12),
        whiteSpace: "nowrap",
        fontVariantNumeric: "tabular-nums",
        ...style,
      }}
    >
      {Math.round(score)}/100
    </span>
  );
};

export const PLATFORMS = [
  { id: "shopify", label: "Shopify", src: "img/shopify.svg" },
  { id: "woocommerce", label: "WooCommerce", src: "img/woocommerce.svg" },
  { id: "wix", label: "Wix", src: "img/wix.svg" },
] as const;

export const PlatformChip: React.FC<{ id: (typeof PLATFORMS)[number]["id"]; size?: number; active?: number; style?: React.CSSProperties }> = ({ id, size = 30, active = 0, style }) => {
  const p = PLATFORMS.find((x) => x.id === id)!;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size * 0.4,
        padding: `${size * 0.42}px ${size * 0.72}px`,
        borderRadius: 999,
        background: active > 0 ? `color-mix(in oklch, ${c.brand50} ${active * 100}%, ${c.default})` : c.default,
        border: `2px solid color-mix(in oklch, ${c.brand500} ${active * 100}%, ${c.border})`,
        boxShadow: active > 0 ? `0 ${12 * active}px ${30 * active}px -12px ${mix(c.brand500, 60)}` : "none",
        fontFamily: fonts.sans,
        fontWeight: 500,
        fontSize: size,
        color: c.eclipse,
        ...style,
      }}
    >
      <Img src={staticFile(p.src)} style={{ height: size * 1.05, width: "auto" }} />
      {p.label}
    </div>
  );
};

/** Glassy product thumbnail used by the sync stream and the audit grid. */
export const Thumb: React.FC<{ src: string; size: number; radius?: number; style?: React.CSSProperties }> = ({ src, size, radius = 18, style }) => (
  <div style={{ width: size, height: size, borderRadius: radius, overflow: "hidden", background: c.surface, flexShrink: 0, ...style }}>
    <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
  </div>
);

/** Deterministic jitter for staggering. */
export const jitter = (seed: string | number, amount = 1) => (random(seed) - 0.5) * 2 * amount;
