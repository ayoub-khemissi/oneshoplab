import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts, accent, accentFg } from "../theme";
import { Wordmark } from "../components/Logo";
import { Sparkle } from "../components/Ui";
import { I18N, type Locale } from "../i18n";

export const Cta: React.FC<{ locale: Locale }> = ({ locale }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const c = I18N[locale].cta;

  const wm = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 22 });
  const head = spring({ frame: frame - 12, fps, config: { damping: 200 }, durationInFrames: 26 });
  const btn = spring({ frame: frame - 26, fps, config: { damping: 160, stiffness: 140 }, durationInFrames: 24 });
  const url = spring({ frame: frame - 38, fps, config: { damping: 200 }, durationInFrames: 20 });

  const pulse = 1 + Math.sin(frame / 7) * 0.015;

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(120% 80% at 50% 18%, ${colors.brand950}, ${colors.ink2} 58%, ${colors.ink2})`,
        alignItems: "center",
        justifyContent: "center",
        fontFamily: fonts.sans,
        textAlign: "center",
        padding: "0 9%",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: width * 1.0,
          height: width * 1.0,
          borderRadius: "50%",
          top: "6%",
          background: "radial-gradient(circle, color-mix(in oklch, " + accent + " 24%, transparent), transparent 60%)",
          filter: "blur(20px)",
        }}
      />

      <div style={{ opacity: wm, transform: `translateY(${(1 - wm) * 16}px)`, zIndex: 2 }}>
        <Wordmark fontFamily={fonts.sans} color="white" markColor={colors.brand300} size={width * 0.055} />
      </div>

      <div
        style={{
          zIndex: 2,
          opacity: head,
          transform: `translateY(${(1 - head) * 22}px)`,
          color: "white",
          fontSize: width * 0.062,
          fontWeight: 600,
          lineHeight: 1.08,
          letterSpacing: "-0.025em",
          margin: `${width * 0.045}px 0`,
        }}
      >
        {c.head1}
        <br />
        <span
          style={{
            background: `linear-gradient(100deg, ${colors.brand300}, ${colors.amber400})`,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
          }}
        >
          {c.head2}
        </span>
      </div>

      <div
        style={{
          zIndex: 2,
          opacity: btn,
          transform: `scale(${interpolate(btn, [0, 1], [0.8, 1]) * pulse})`,
          display: "inline-flex",
          alignItems: "center",
          gap: 12,
          fontSize: width * 0.034,
          fontWeight: 600,
          color: accentFg,
          background: accent,
          padding: `${width * 0.022}px ${width * 0.05}px`,
          borderRadius: 999,
          boxShadow: `0 18px 50px -14px color-mix(in oklch, ${accent} 70%, transparent)`,
        }}
      >
        <Sparkle size={width * 0.032} />
        {c.button}
      </div>

      <div
        style={{
          zIndex: 2,
          marginTop: width * 0.04,
          opacity: url,
          fontFamily: fonts.mono,
          fontSize: width * 0.026,
          letterSpacing: "0.08em",
          color: "rgba(255,255,255,0.7)",
        }}
      >
        {c.url}
      </div>
    </AbsoluteFill>
  );
};
