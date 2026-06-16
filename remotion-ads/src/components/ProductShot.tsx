import React from "react";
import { Img, interpolate, staticFile } from "remotion";
import { colors } from "../theme";

/**
 * Fallback product when no photo is supplied: a simple serum/cosmetic bottle in
 * SVG so the ad still renders. Real usage passes rawSrc + enhancedSrc.
 */
const BottleMock: React.FC = () => (
  <svg viewBox="0 0 200 320" width="58%" style={{ display: "block" }}>
    <defs>
      <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="oklch(0.92 0.05 250)" />
        <stop offset="0.5" stopColor="oklch(0.80 0.10 250)" />
        <stop offset="1" stopColor="oklch(0.62 0.16 250)" />
      </linearGradient>
    </defs>
    <rect x="78" y="8" width="44" height="40" rx="8" fill={colors.brand700} />
    <rect x="70" y="44" width="60" height="20" rx="6" fill={colors.brand800} />
    <path
      d="M64 80c0-12 10-22 22-22h28c12 0 22 10 22 22v200c0 14-11 25-25 25H89c-14 0-25-11-25-25V80z"
      fill="url(#glass)"
    />
    <rect x="82" y="150" width="36" height="96" rx="8" fill="rgba(255,255,255,0.18)" />
    <rect x="72" y="92" width="14" height="150" rx="7" fill="rgba(255,255,255,0.35)" />
  </svg>
);

export const ProductShot: React.FC<{
  /** 0 = raw catalog photo, 1 = AI-enhanced lifestyle shot */
  progress: number;
  /** "before": a flat, plain catalog packshot (e.g. studio on white) */
  rawSrc?: string | null;
  /** "after": the AI-generated rich lifestyle / in-context shot */
  enhancedSrc?: string | null;
  /** vertical sweep position of the AI scan line, 0..1 */
  scan?: number;
}> = ({ progress, rawSrc, enhancedSrc, scan }) => {
  const p = Math.max(0, Math.min(1, progress));
  const s = scan ?? p;

  const rawOpacity = interpolate(p, [0, 0.55], [1, 0], { extrapolateRight: "clamp" });
  const enhOpacity = interpolate(p, [0.4, 1], [0, 1], { extrapolateLeft: "clamp" });
  const enhScale = interpolate(p, [0.4, 1], [1.12, 1.0], { extrapolateLeft: "clamp" });

  const scanVisible = interpolate(p, [0.05, 0.2, 0.85, 1], [0, 1, 1, 0]);
  const scanY = `${interpolate(s, [0, 1], [-2, 102])}%`;

  const rawFilter = "grayscale(0.3) brightness(0.94) contrast(0.95) saturate(0.85)";

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "1 / 1",
        borderRadius: 18,
        overflow: "hidden",
        border: `1px solid ${colors.border}`,
      }}
    >
      {/* BEFORE — flat, dull packshot floating on plain grey */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: rawOpacity,
          background: "linear-gradient(160deg, oklch(0.91 0.005 250), oklch(0.84 0.006 250))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {rawSrc ? (
          <Img src={staticFile(rawSrc)} style={{ width: "82%", height: "82%", objectFit: "contain", filter: rawFilter }} />
        ) : (
          <div style={{ filter: rawFilter, display: "flex", justifyContent: "center" }}>
            <BottleMock />
          </div>
        )}
      </div>

      {/* AFTER — rich AI lifestyle shot filling the frame */}
      <div style={{ position: "absolute", inset: 0, opacity: enhOpacity, overflow: "hidden" }}>
        {enhancedSrc ? (
          <>
            <Img
              src={staticFile(enhancedSrc)}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transform: `scale(${enhScale})`,
                filter: "saturate(1.12) contrast(1.05)",
              }}
            />
            {/* subtle vignette + brand wash so it reads premium */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "radial-gradient(120% 100% at 50% 30%, transparent 55%, rgba(15,23,42,0.18)), linear-gradient(180deg, transparent 70%, color-mix(in oklch, " +
                  colors.brand900 +
                  " 22%, transparent))",
              }}
            />
          </>
        ) : (
          // no dedicated "after" image → put the raw product on a studio backdrop
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(120% 90% at 50% 30%, oklch(0.97 0.03 250), oklch(0.90 0.05 260))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div style={{ filter: "drop-shadow(0 30px 40px rgba(15,23,42,0.30))", transform: `scale(${enhScale})` }}>
              {rawSrc ? (
                <Img src={staticFile(rawSrc)} style={{ width: "82%", height: "82%", objectFit: "contain", filter: "saturate(1.15)" }} />
              ) : (
                <BottleMock />
              )}
            </div>
          </div>
        )}
      </div>

      {/* AI scan line sweeping over the product during the transform */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: scanY,
          height: 4,
          opacity: scanVisible,
          background:
            "linear-gradient(90deg, transparent, oklch(0.660 0.190 250), oklch(0.830 0.140 75), transparent)",
          boxShadow: "0 0 26px 6px color-mix(in oklch, oklch(0.660 0.190 250) 55%, transparent)",
        }}
      />
    </div>
  );
};
