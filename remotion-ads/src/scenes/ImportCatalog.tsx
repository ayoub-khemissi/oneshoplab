import React from "react";
import { Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts, accent } from "../theme";
import { BrowserFrame } from "../components/BrowserFrame";
import { Stage, DESIGN } from "../components/Stage";
import { VerticalBands, useIsVertical } from "../components/VerticalBands";
import { Wordmark } from "../components/Logo";
import { Eyebrow, Pill, Button } from "../components/Ui";
import { Cursor } from "../components/Cursor";
import { I18N, type Locale, type ProductKey } from "../i18n";

const PRODUCTS: { key: ProductKey; score: number; img: string }[] = [
  { key: "sneaker", score: 48, img: "products/sneaker-studio.png" },
  { key: "watch", score: 41, img: "products/watch.png" },
  { key: "headphones", score: 56, img: "products/headphones.png" },
  { key: "sunglasses", score: 39, img: "products/sunglasses.png" },
];

const ScoreChip: React.FC<{ score: number }> = ({ score }) => {
  const c = score < 50 ? colors.amber500 : colors.brand500;
  return (
    <div
      style={{
        width: 46,
        height: 46,
        borderRadius: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: fonts.mono,
        fontWeight: 600,
        fontSize: 20,
        color: c,
        background: "color-mix(in oklch, " + c + " 12%, transparent)",
        border: "1px solid color-mix(in oklch, " + c + " 30%, transparent)",
      }}
    >
      {score}
    </div>
  );
};

export const ImportCatalog: React.FC<{ locale: Locale }> = ({ locale }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const c = I18N[locale];

  const frameIn = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 26 });
  const toast = interpolate(frame, [40, 52, 118, 130], [0, 1, 1, 0], { extrapolateRight: "clamp" });
  const isVertical = useIsVertical();

  // cursor travels to the sneaker's "Optimiser" button (first row) and clicks,
  // then holds there so it carries over into the optimize scene.
  const impClick = 132;
  const impTravel = interpolate(frame, [92, impClick], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const cursorX = interpolate(impTravel, [0, 1], [0.58, 0.885]) * 100;
  const cursorY = interpolate(impTravel, [0, 1], [0.9, 0.40]) * 100;
  const click = interpolate(frame, [impClick, impClick + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const cursorOpacity = interpolate(frame, [84, 96], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <>
    <Stage
      designWidth={DESIGN.width}
      designHeight={DESIGN.height}
      margin={isVertical ? 0.82 : 0.94}
      background={`linear-gradient(180deg, ${colors.bg}, oklch(0.965 0.012 255))`}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          fontFamily: fonts.sans,
          opacity: frameIn,
          transform: `translateY(${(1 - frameIn) * 30}px)`,
        }}
      >
        <BrowserFrame>
          <div style={{ padding: "26px 30px 30px" }}>
            {/* app header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
              <Wordmark fontFamily={fonts.sans} color={colors.foreground} markColor={accent} size={30} showBeta />
              <Pill variant="accent">{c.credits(7268)}</Pill>
            </div>

            <Eyebrow>{c.import.eyebrow}</Eyebrow>
            <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: "-0.02em", color: colors.foreground, margin: "10px 0 20px" }}>
              {c.import.heading}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {PRODUCTS.map((p, i) => {
                const cardIn = spring({
                  frame: frame - 24 - i * 12,
                  fps,
                  config: { damping: 200 },
                  durationInFrames: 22,
                });
                const product = c.products[p.key];
                return (
                  <div
                    key={p.key}
                    style={{
                      opacity: cardIn,
                      transform: `translateX(${(1 - cardIn) * -28}px)`,
                      display: "flex",
                      alignItems: "center",
                      gap: 18,
                      padding: "16px 18px",
                      borderRadius: 16,
                      background: colors.surface,
                      border: `1px solid ${colors.border}`,
                    }}
                  >
                    <Img
                      src={staticFile(p.img)}
                      style={{
                        width: 60,
                        height: 60,
                        borderRadius: 12,
                        objectFit: "cover",
                        background: "white",
                        border: `1px solid ${colors.border}`,
                        flexShrink: 0,
                      }}
                    />
                    <ScoreChip score={p.score} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 21, fontWeight: 600, color: colors.foreground }}>{product.name}</div>
                      <div style={{ marginTop: 7, display: "flex", gap: 8, alignItems: "center" }}>
                        <Pill>{product.type}</Pill>
                        <span style={{ fontFamily: fonts.mono, fontSize: 13, color: colors.amber500 }}>
                          {c.import.issues}
                        </span>
                      </div>
                    </div>
                    <Button>{c.import.optimize}</Button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* connected toast */}
          <div
            style={{
              position: "absolute",
              right: 26,
              top: 80,
              opacity: toast,
              transform: `translateY(${(1 - toast) * -10}px)`,
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "11px 16px",
              borderRadius: 12,
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              boxShadow: "0 16px 36px -16px rgba(15,23,42,0.4)",
              fontFamily: fonts.sans,
              fontSize: 16,
              color: colors.foreground,
            }}
          >
            <span style={{ width: 9, height: 9, borderRadius: 99, background: "oklch(0.72 0.18 150)", boxShadow: "0 0 10px oklch(0.72 0.18 150)" }} />
            {c.import.toast}
          </div>
        </BrowserFrame>

        <div style={{ position: "absolute", inset: 0, opacity: cursorOpacity }}>
          <Cursor x={`${cursorX}%`} y={`${cursorY}%`} click={click} />
        </div>
      </div>
    </Stage>
    <VerticalBands step={c.bands.import.step} headline={c.bands.import.headline} accentWord={c.bands.import.accent} />
    </>
  );
};
