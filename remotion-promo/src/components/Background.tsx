import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { noise2D } from "@remotion/noise";
import { c, mix } from "../theme";
import { CUE, S, prog, ease } from "../motion";
import { BLOOM_ORIGIN } from "../scenes/Pause";

/**
 * The world behind every scene, full-bleed in both formats:
 * night (ink + drifting aurora) → the dot blooms into the light app world →
 * dawn for the morning lock screen → light again for the end card.
 */
export const Background: React.FC<{ f: number; stageScale: number; stageX: number }> = ({ f, stageScale, stageX }) => {
  const { width, height } = useVideoConfig();

  // Bloom: a circle centred on the dot, in frame coordinates.
  const ox = stageX + BLOOM_ORIGIN.x * stageScale;
  const oy = BLOOM_ORIGIN.y * stageScale;
  const bloom = prog(f, CUE.bloom, CUE.bloom + 50, ease.outExpo);
  const maxR = Math.hypot(Math.max(ox, width - ox), Math.max(oy, height - oy)) + 40;
  const r = bloom * maxR;

  const nightDim = prog(f, CUE.freeze, CUE.dotCollapse + 20, ease.inOut);
  const dawn = prog(f, S.morning.from - 20, S.morning.from + 30, ease.inOut) * (1 - prog(f, S.morning.to - 20, S.morning.to + 20, ease.inOut));

  const a1x = 30 + noise2D("ax", f / 400, 0) * 25;
  const a1y = 70 + noise2D("ay", f / 400, 1) * 12;
  const a2x = 75 + noise2D("bx", f / 380, 2) * 20;
  const a2y = 25 + noise2D("by", f / 380, 3) * 15;

  return (
    <AbsoluteFill>
      {/* Night */}
      {f < CUE.bloom + 60 ? (
        <AbsoluteFill style={{ background: c.night }}>
          <AbsoluteFill
            style={{
              opacity: 1 - nightDim * 0.85,
              background: `radial-gradient(60% 40% at ${a1x}% ${a1y}%, ${mix(c.brand800, 55)}, transparent 70%),
                radial-gradient(50% 35% at ${a2x}% ${a2y}%, ${mix(c.brand700, 30)}, transparent 70%),
                radial-gradient(120% 60% at 50% 110%, ${mix(c.brand900, 90)}, transparent 70%)`,
            }}
          />
        </AbsoluteFill>
      ) : null}

      {/* Light world, revealed by the bloom circle */}
      {f >= CUE.bloom ? (
        <AbsoluteFill style={{ clipPath: bloom < 1 ? `circle(${r}px at ${ox}px ${oy}px)` : undefined }}>
          <LightWorld f={f} />
        </AbsoluteFill>
      ) : null}
      {f >= CUE.bloom && bloom < 1 ? (
        <div
          style={{
            position: "absolute",
            left: ox - r,
            top: oy - r,
            width: r * 2,
            height: r * 2,
            borderRadius: "50%",
            boxShadow: `0 0 80px 30px ${mix(c.brand400, 60 * (1 - bloom))}, inset 0 0 60px 10px ${mix(c.brand300, 70 * (1 - bloom))}`,
          }}
        />
      ) : null}

      {/* Dawn */}
      {dawn > 0 ? (
        <AbsoluteFill style={{ opacity: dawn }}>
          <AbsoluteFill
            style={{
              background: `linear-gradient(180deg, ${c.brand700} 0%, ${c.brand400} 38%, oklch(0.84 0.07 60) 78%, ${c.amber300} 100%)`,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: `${100 - prog(f, S.morning.from - 20, S.morning.to, ease.outQuart) * 22}%`,
              width: width * 1.4,
              height: width * 1.4,
              transform: "translate(-50%, -50%)",
              borderRadius: "50%",
              background: `radial-gradient(circle, oklch(0.97 0.06 85) 0%, ${mix(c.amber400, 60)} 25%, transparent 60%)`,
              filter: "blur(20px)",
            }}
          />
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};

const LightWorld: React.FC<{ f: number }> = ({ f }) => {
  const drift = noise2D("lw", f / 500, 0) * 8;
  return (
    <AbsoluteFill style={{ background: c.bg }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(70% 45% at ${50 + drift}% 0%, ${mix(c.brand100, 90)}, transparent 70%),
            radial-gradient(60% 40% at ${50 - drift}% 100%, ${mix(c.brand50, 100)}, transparent 70%)`,
        }}
      />
      {/* the site's faint grid */}
      <AbsoluteFill
        style={{
          opacity: 0.55,
          backgroundImage: `linear-gradient(${mix(c.brand200, 25)} 1px, transparent 1px), linear-gradient(90deg, ${mix(c.brand200, 25)} 1px, transparent 1px)`,
          backgroundSize: "72px 72px",
          backgroundPosition: `${f * 0.15}px ${f * 0.3}px`,
          maskImage: "radial-gradient(ellipse 80% 60% at 50% 40%, black, transparent 80%)",
        }}
      />
    </AbsoluteFill>
  );
};
