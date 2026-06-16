import React from "react";
import { Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts, accent, accentFg } from "../theme";
import { BrowserFrame } from "../components/BrowserFrame";
import { Stage, DESIGN } from "../components/Stage";
import { VerticalBands, useIsVertical } from "../components/VerticalBands";
import { Wordmark } from "../components/Logo";
import { Eyebrow, Pill, Button, Sparkle } from "../components/Ui";
import { ProductShot } from "../components/ProductShot";
import { Cursor } from "../components/Cursor";
import { I18N, type Locale } from "../i18n";
import { HERO_RAW, HERO_ENHANCED, HERO_ANGLES } from "../product";

export const OptimizeReveal: React.FC<{ locale: Locale }> = ({ locale }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const c = I18N[locale];
  const SEO_TITLE = c.hero.seoTitle;

  const frameIn = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 24 });
  const isVertical = useIsVertical();

  // ── cursor carries over from the catalog "Optimiser" click, then glides to
  //    "Tout générer" and clicks it ──────────────────────────────────────────
  const clickFrame = 52;
  const travel = interpolate(frame, [10, clickFrame], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // starts where the catalog "Optimiser" button was (far right) → slides to the button
  const cursorX = interpolate(travel, [0, 1], [0.885, 0.515]) * 100;
  const cursorY = interpolate(travel, [0, 1], [0.42, 0.33]) * 100;
  const click = interpolate(frame, [clickFrame, clickFrame + 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const generating = frame >= clickFrame + 6;
  const genProgress = interpolate(frame, [clickFrame + 6, 150], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // typewriter for the SEO title
  const titleChars = Math.floor(Math.max(0, frame - (clickFrame + 16)) * 1.7);
  const typedTitle = SEO_TITLE.slice(0, titleChars);
  const titleDone = titleChars >= SEO_TITLE.length;

  // image transform raw -> enhanced
  const imgProgress = interpolate(frame, [clickFrame + 20, 150], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // score + credits counters
  const score = Math.round(interpolate(frame, [150, 195], [61, 92], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  // 3 generated images × 21 credits = 63 credits debited
  const credits = Math.round(interpolate(frame, [clickFrame + 6, clickFrame + 40], [7268, 7205], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));

  const labelStyle: React.CSSProperties = {
    fontFamily: fonts.mono,
    fontSize: 13,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: colors.muted,
    marginBottom: 8,
  };

  return (
    <>
    <Stage
      designWidth={DESIGN.width}
      designHeight={DESIGN.height}
      margin={isVertical ? 0.82 : 0.94}
      background={`linear-gradient(180deg, ${colors.bg}, oklch(0.96 0.014 255))`}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          fontFamily: fonts.sans,
          opacity: frameIn,
          transform: `translateY(${(1 - frameIn) * 24}px)`,
        }}
      >
        <BrowserFrame url="www.oneshoplab.com/dashboard/products/premium-sneakers">
          <div style={{ padding: "24px 28px 28px" }}>
            {/* header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <Wordmark fontFamily={fonts.sans} color={colors.foreground} markColor={accent} size={26} showBeta={false} />
              <Pill variant="accent">{c.credits(credits)}</Pill>
            </div>

            {/* title + score */}
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
              <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.02em", color: colors.foreground }}>
                {c.hero.name}
              </div>
              <div
                style={{
                  fontFamily: fonts.mono,
                  fontWeight: 600,
                  fontSize: 17,
                  padding: "5px 12px",
                  borderRadius: 10,
                  color: score >= 80 ? "oklch(0.62 0.17 150)" : colors.amber500,
                  background:
                    "color-mix(in oklch, " + (score >= 80 ? "oklch(0.62 0.17 150)" : colors.amber500) + " 14%, transparent)",
                }}
              >
                {c.optimize.score(score)}
              </div>
            </div>

            {/* two columns */}
            <div style={{ display: "grid", gridTemplateColumns: "40% 1fr", gap: 26 }}>
              {/* left: product image transforms + the 3 generated angles */}
              <div>
                <div style={labelStyle}>{c.optimize.visual}</div>
                <ProductShot progress={imgProgress} scan={imgProgress} rawSrc={HERO_RAW} enhancedSrc={HERO_ENHANCED} />

                <div style={{ marginTop: 16 }}>
                  <div style={labelStyle}>{c.optimize.imagesLabel}</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {HERO_ANGLES.map((a, i) => {
                      const pop = spring({
                        frame: frame - (158 + i * 9),
                        fps,
                        config: { damping: 200, stiffness: 150 },
                        durationInFrames: 18,
                      });
                      return (
                        <div key={a.key} style={{ flex: 1, opacity: pop, transform: `scale(${interpolate(pop, [0, 1], [0.7, 1])})` }}>
                          <Img
                            src={staticFile(a.src)}
                            style={{
                              width: "100%",
                              aspectRatio: "1 / 1",
                              objectFit: "cover",
                              borderRadius: 10,
                              background: "white",
                              border: `1px solid ${colors.border}`,
                            }}
                          />
                          <div style={{ marginTop: 5, fontFamily: fonts.mono, fontSize: 12, color: colors.muted, textAlign: "center" }}>
                            {c.optimize.angles[a.key]}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* right: AI suggestions */}
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <Eyebrow>{c.optimize.eyebrow}</Eyebrow>
                  {/* Source / IA toggle */}
                  <div style={{ display: "flex", background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 3, fontFamily: fonts.mono, fontSize: 13 }}>
                    <span style={{ padding: "5px 12px", borderRadius: 7, color: colors.muted }}>{c.optimize.source}</span>
                    <span style={{ padding: "5px 12px", borderRadius: 7, color: accentFg, background: accent }}>{c.optimize.ai}</span>
                  </div>
                </div>

                {/* generate button */}
                <div data-btn style={{ marginBottom: 20 }}>
                  <Button style={generating ? { opacity: 0.9 } : undefined}>
                    <Sparkle />
                    {generating ? (titleDone ? c.optimize.regenerateAll : c.optimize.generating) : c.optimize.generateAll}
                  </Button>
                </div>

                {/* Title field */}
                <div style={{ marginBottom: 18 }}>
                  <div style={labelStyle}>{c.optimize.titleLabel}</div>
                  <div style={{ fontSize: 20, fontWeight: 600, color: colors.foreground, lineHeight: 1.3, minHeight: 28 }}>
                    {generating ? (
                      <>
                        {typedTitle}
                        {!titleDone ? <Caret /> : null}
                      </>
                    ) : (
                      <span style={{ color: colors.muted, fontWeight: 400, fontStyle: "italic" }}>
                        {c.optimize.emptyTitle}
                      </span>
                    )}
                  </div>
                </div>

                {/* Description field */}
                <div style={{ marginBottom: 18 }}>
                  <div style={labelStyle}>{c.optimize.descLabel}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {c.hero.desc.map((line, i) => {
                      const lineIn = interpolate(frame, [108 + i * 14, 124 + i * 14], [0, 1], {
                        extrapolateLeft: "clamp",
                        extrapolateRight: "clamp",
                      });
                      return (
                        <div
                          key={i}
                          style={{
                            opacity: lineIn,
                            transform: `translateY(${(1 - lineIn) * 8}px)`,
                            fontSize: 16,
                            lineHeight: 1.5,
                            color: colors.foreground,
                          }}
                        >
                          {line}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Tags field */}
                <div>
                  <div style={labelStyle}>{c.optimize.tagsLabel}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 9 }}>
                    {c.hero.tags.map((t, i) => {
                      const tagIn = spring({
                        frame: frame - (150 + i * 7),
                        fps,
                        config: { damping: 200, stiffness: 160 },
                        durationInFrames: 16,
                      });
                      return (
                        <div
                          key={t}
                          style={{
                            opacity: tagIn,
                            transform: `scale(${interpolate(tagIn, [0, 1], [0.6, 1])})`,
                          }}
                        >
                          <Pill variant="accent">{t}</Pill>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* progress shimmer bar under the chrome while generating */}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              height: 3,
              opacity: interpolate(genProgress, [0, 0.05, 0.95, 1], [0, 1, 1, 0]),
              background: `linear-gradient(90deg, transparent, ${accent}, ${colors.amber400}, transparent)`,
              transform: `translateX(${interpolate(genProgress, [0, 1], [-100, 100])}%)`,
            }}
          />
        </BrowserFrame>

        {/* cursor lives in the same relative box as the frame */}
        <Cursor x={`${cursorX}%`} y={`${cursorY}%`} click={click} />
      </div>
    </Stage>
    <VerticalBands step={c.bands.optimize.step} headline={c.bands.optimize.headline} accentWord={c.bands.optimize.accent} />
    </>
  );
};

const Caret: React.FC = () => {
  const frame = useCurrentFrame();
  const on = Math.floor(frame / 8) % 2 === 0;
  return (
    <span
      style={{
        display: "inline-block",
        width: 3,
        height: "0.95em",
        marginLeft: 3,
        verticalAlign: "text-bottom",
        background: accent,
        opacity: on ? 1 : 0,
      }}
    />
  );
};
