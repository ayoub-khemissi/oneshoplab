import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts, accent } from "../theme";
import { Wordmark, LogoMark } from "../components/Logo";
import { I18N, type Locale } from "../i18n";

export const Intro: React.FC<{ locale: Locale }> = ({ locale }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const c = I18N[locale].intro;

  const wordmarkIn = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 22 });
  const titleIn = spring({ frame: frame - 14, fps, config: { damping: 200 }, durationInFrames: 26 });
  const subIn = spring({ frame: frame - 28, fps, config: { damping: 200 }, durationInFrames: 24 });

  const titleSize = width * 0.082;

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(120% 80% at 50% 12%, ${colors.brand950}, ${colors.ink2} 55%, ${colors.ink2})`,
        alignItems: "center",
        justifyContent: "center",
        fontFamily: fonts.sans,
      }}
    >
      {/* hero glow */}
      <div
        style={{
          position: "absolute",
          width: width * 1.1,
          height: width * 1.1,
          borderRadius: "50%",
          top: "-22%",
          background:
            "radial-gradient(circle, color-mix(in oklch, " + accent + " 26%, transparent), transparent 60%)",
          filter: "blur(20px)",
        }}
      />
      {/* floating mark watermark */}
      <LogoMark
        size={width * 0.62}
        fill={"color-mix(in oklch, " + accent + " 10%, transparent)"}
        style={{
          position: "absolute",
          right: -width * 0.16,
          bottom: -width * 0.14,
          transform: `rotate(${interpolate(frame, [0, 75], [-6, 2])}deg)`,
        }}
      />

      <div
        style={{
          position: "absolute",
          top: "16%",
          opacity: wordmarkIn,
          transform: `translateY(${(1 - wordmarkIn) * 18}px)`,
        }}
      >
        <Wordmark fontFamily={fonts.sans} color="white" markColor={colors.brand300} size={width * 0.05} />
      </div>

      <div style={{ textAlign: "center", padding: "0 8%", zIndex: 2 }}>
        <div
          style={{
            opacity: titleIn,
            transform: `translateY(${(1 - titleIn) * 26}px)`,
            color: "white",
            fontSize: titleSize,
            fontWeight: 600,
            lineHeight: 1.04,
            letterSpacing: "-0.03em",
          }}
        >
          {c.title1}
          <br />
          <span
            style={{
              background: `linear-gradient(100deg, ${colors.brand300}, ${colors.amber400})`,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            {c.title2}
          </span>
        </div>

        <div
          style={{
            marginTop: width * 0.04,
            opacity: subIn,
            transform: `translateY(${(1 - subIn) * 16}px)`,
            display: "flex",
            gap: 14,
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          {["Shopify", "WooCommerce", "Wix"].map((p) => (
            <span
              key={p}
              style={{
                fontFamily: fonts.mono,
                fontSize: width * 0.026,
                color: "rgba(255,255,255,0.82)",
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(255,255,255,0.05)",
                padding: "8px 16px",
                borderRadius: 99,
              }}
            >
              {p}
            </span>
          ))}
          {/* catch-all: any other store can be added manually */}
          <span
            style={{
              fontFamily: fonts.mono,
              fontSize: width * 0.026,
              fontWeight: 600,
              color: colors.amber400,
              border: `1px solid color-mix(in oklch, ${colors.amber400} 55%, transparent)`,
              background: `color-mix(in oklch, ${colors.amber400} 14%, transparent)`,
              padding: "8px 16px",
              borderRadius: 99,
              boxShadow: `0 0 18px -4px color-mix(in oklch, ${colors.amber400} 50%, transparent)`,
            }}
          >
            {c.anyStore}
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
