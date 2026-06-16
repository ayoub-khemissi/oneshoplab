import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts, accent } from "../theme";
import { Wordmark } from "./Logo";

/** True when the composition is taller than it is wide (9:16 etc.). */
export const useIsVertical = () => {
  const { width, height } = useVideoConfig();
  return height / width >= 1.25;
};

/**
 * Top headline + bottom brand line that only appear in vertical formats, to
 * fill the space above/below the centered browser mockup. No-op in 1:1.
 */
export const VerticalBands: React.FC<{ step: string; headline: string; accentWord?: string }> = ({
  step,
  headline,
  accentWord,
}) => {
  const isVertical = useIsVertical();
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  if (!isVertical) return null;

  const topIn = spring({ frame: frame - 6, fps, config: { damping: 200 }, durationInFrames: 24 });
  const botIn = spring({ frame: frame - 14, fps, config: { damping: 200 }, durationInFrames: 24 });

  return (
    <AbsoluteFill
      style={{
        flexDirection: "column",
        justifyContent: "space-between",
        alignItems: "center",
        padding: `${width * 0.1}px ${width * 0.08}px`,
        pointerEvents: "none",
      }}
    >
      {/* top headline */}
      <div
        style={{
          textAlign: "center",
          opacity: topIn,
          transform: `translateY(${(1 - topIn) * -18}px)`,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            fontFamily: fonts.mono,
            fontSize: width * 0.026,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: accent,
            marginBottom: width * 0.03,
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: 99, background: accent, boxShadow: `0 0 10px ${accent}` }} />
          {step}
        </div>
        <div
          style={{
            fontFamily: fonts.sans,
            fontSize: width * 0.058,
            fontWeight: 600,
            lineHeight: 1.08,
            letterSpacing: "-0.025em",
            color: colors.foreground,
          }}
        >
          {headline}{" "}
          {accentWord ? (
            <span
              style={{
                background: `linear-gradient(100deg, ${colors.brand500}, ${colors.amber500})`,
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              {accentWord}
            </span>
          ) : null}
        </div>
      </div>

      {/* bottom brand line */}
      <div style={{ opacity: botIn, display: "flex", flexDirection: "column", alignItems: "center", gap: width * 0.02 }}>
        <Wordmark fontFamily={fonts.sans} color={colors.foreground} markColor={accent} size={width * 0.045} showBeta={false} />
        <div style={{ fontFamily: fonts.mono, fontSize: width * 0.026, letterSpacing: "0.1em", color: colors.muted }}>
          oneshoplab.com
        </div>
      </div>
    </AbsoluteFill>
  );
};
