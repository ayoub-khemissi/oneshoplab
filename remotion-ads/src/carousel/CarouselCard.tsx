import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { colors, fonts, accent, accentFg } from "../theme";
import { Wordmark, LogoMark } from "../components/Logo";
import { Sparkle } from "../components/Ui";
import { I18N, type Locale } from "../i18n";

const W = 1080;

// ── shared chrome ───────────────────────────────────────────────────────────
const Background: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(120% 80% at 50% 8%, ${colors.brand950}, ${colors.ink2} 58%, ${colors.ink2})`,
      fontFamily: fonts.sans,
    }}
  >
    <div
      style={{
        position: "absolute",
        width: W * 1.0,
        height: W * 1.0,
        top: "-26%",
        left: "50%",
        transform: "translateX(-50%)",
        borderRadius: "50%",
        background: `radial-gradient(circle, color-mix(in oklch, ${accent} 24%, transparent), transparent 60%)`,
        filter: "blur(20px)",
      }}
    />
    <LogoMark
      size={W * 0.62}
      fill={`color-mix(in oklch, ${accent} 8%, transparent)`}
      style={{ position: "absolute", right: -W * 0.16, bottom: -W * 0.14 }}
    />
    {children}
  </AbsoluteFill>
);

const TopBar: React.FC<{ index: number }> = ({ index }) => (
  <div
    style={{
      position: "absolute",
      top: 56,
      left: 64,
      right: 64,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    }}
  >
    <Wordmark fontFamily={fonts.sans} color="white" markColor={colors.brand300} size={42} showBeta={false} />
    <div style={{ display: "flex", gap: 10 }}>
      {[1, 2, 3, 4, 5].map((d) => (
        <span
          key={d}
          style={{
            width: d === index ? 30 : 10,
            height: 10,
            borderRadius: 99,
            background: d === index ? accent : "rgba(255,255,255,0.22)",
            boxShadow: d === index ? `0 0 12px ${accent}` : "none",
          }}
        />
      ))}
    </div>
  </div>
);

const Kicker: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 12,
      fontFamily: fonts.mono,
      fontSize: 26,
      letterSpacing: "0.16em",
      textTransform: "uppercase",
      color: colors.brand300,
      marginBottom: 22,
    }}
  >
    <span style={{ width: 10, height: 10, borderRadius: 99, background: accent, boxShadow: `0 0 12px ${accent}` }} />
    {children}
  </div>
);

const Title: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 64 }) => (
  <div style={{ color: "white", fontSize: size, fontWeight: 600, lineHeight: 1.07, letterSpacing: "-0.025em" }}>
    {children}
  </div>
);

// ── card 1 — hook / problem ─────────────────────────────────────────────────
const CardHook: React.FC<{ c: ReturnType<typeof tr> }> = ({ c }) => (
  <>
    {/* dim messy "before" photo as a pain cue */}
    <Img
      src={staticFile("products/sneaker-raw.png")}
      style={{
        position: "absolute",
        right: -80,
        top: "50%",
        transform: "translateY(-50%)",
        width: 560,
        height: 560,
        objectFit: "cover",
        borderRadius: 28,
        opacity: 0.22,
        filter: "grayscale(0.3)",
        maskImage: "linear-gradient(90deg, transparent, black 55%)",
        WebkitMaskImage: "linear-gradient(90deg, transparent, black 55%)",
      }}
    />
    <div style={{ position: "absolute", left: 72, right: 72, top: "50%", transform: "translateY(-50%)" }}>
      <Kicker>{c.carousel.hookKicker}</Kicker>
      <Title size={84}>{c.carousel.hookTitle}</Title>
    </div>
  </>
);

// ── card 2 — SEO copy benefit ───────────────────────────────────────────────
const MiniBrowser: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      width: 884,
      borderRadius: 22,
      overflow: "hidden",
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      boxShadow: "0 50px 100px -30px rgba(0,0,0,0.6)",
    }}
  >
    <div style={{ height: 54, background: colors.bg, borderBottom: `1px solid ${colors.border}`, display: "flex", alignItems: "center", gap: 10, padding: "0 20px" }}>
      {["#ff5f57", "#febc2e", "#28c840"].map((x) => (
        <span key={x} style={{ width: 13, height: 13, borderRadius: 99, background: x }} />
      ))}
      <div style={{ flex: 1, height: 32, marginLeft: 8, borderRadius: 9, background: colors.surface, border: `1px solid ${colors.border}`, display: "flex", alignItems: "center", padding: "0 14px", fontFamily: fonts.mono, fontSize: 15, color: colors.muted }}>
        www.oneshoplab.com/dashboard/products/premium-sneakers
      </div>
    </div>
    <div style={{ padding: 30 }}>{children}</div>
  </div>
);

const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontFamily: fonts.mono, fontSize: 16, letterSpacing: "0.1em", textTransform: "uppercase", color: colors.muted, margin: "0 0 10px" }}>
    {children}
  </div>
);

const CardSeo: React.FC<{ c: ReturnType<typeof tr> }> = ({ c }) => (
  <CenterVisual>
    <MiniBrowser>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div style={{ fontSize: 30, fontWeight: 600, color: colors.foreground }}>{c.hero.name}</div>
        <span style={{ fontFamily: fonts.mono, fontWeight: 600, fontSize: 18, padding: "6px 14px", borderRadius: 10, color: "oklch(0.62 0.17 150)", background: "color-mix(in oklch, oklch(0.62 0.17 150) 14%, transparent)" }}>
          {c.optimize.score(92)}
        </span>
      </div>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: "9px 16px", borderRadius: 12, background: accent, color: accentFg, fontSize: 18, fontWeight: 600, marginBottom: 22 }}>
        <Sparkle /> {c.optimize.generateAll}
      </div>
      <FieldLabel>{c.optimize.titleLabel}</FieldLabel>
      <div style={{ fontSize: 24, fontWeight: 600, color: colors.foreground, lineHeight: 1.3, marginBottom: 20 }}>{c.hero.seoTitle}</div>
      <FieldLabel>{c.optimize.descLabel}</FieldLabel>
      <div style={{ fontSize: 18, lineHeight: 1.55, color: colors.foreground, marginBottom: 20 }}>{c.hero.desc[0]}</div>
      <FieldLabel>{c.optimize.tagsLabel}</FieldLabel>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {c.hero.tags.map((t) => (
          <span key={t} style={{ fontFamily: fonts.mono, fontSize: 16, padding: "6px 13px", borderRadius: 8, color: accent, background: `color-mix(in oklch, ${accent} 12%, transparent)` }}>{t}</span>
        ))}
      </div>
    </MiniBrowser>
  </CenterVisual>
);

// ── card 3 — before / after photo ───────────────────────────────────────────
const CardPhoto: React.FC<{ c: ReturnType<typeof tr> }> = ({ c }) => {
  const Panel: React.FC<{ src: string; label: string; after?: boolean }> = ({ src, label, after }) => (
    <div style={{ position: "relative", width: 392, height: 392, borderRadius: 24, overflow: "hidden", border: `1px solid ${after ? `color-mix(in oklch, ${accent} 60%, transparent)` : "rgba(255,255,255,0.12)"}`, boxShadow: after ? `0 0 50px -10px color-mix(in oklch, ${accent} 60%, transparent)` : "none" }}>
      <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover", filter: after ? "saturate(1.08)" : "saturate(0.9) brightness(0.96)" }} />
      <span style={{ position: "absolute", top: 16, left: 16, fontFamily: fonts.mono, fontSize: 18, fontWeight: 600, padding: "6px 14px", borderRadius: 99, color: after ? accentFg : "white", background: after ? accent : "rgba(0,0,0,0.55)" }}>{label}</span>
      {after ? (
        <span style={{ position: "absolute", top: 14, right: 14, display: "flex" }}><Sparkle size={30} color={colors.amber400} /></span>
      ) : null}
    </div>
  );
  return (
    <CenterVisual>
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <Panel src="products/sneaker-raw.png" label={c.carousel.before} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", color: accent }}>
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke={accent} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <Panel src="products/sneaker-studio.png" label={c.carousel.after} after />
      </div>
    </CenterVisual>
  );
};

// ── card 4 — integration hub ────────────────────────────────────────────────
const CardImport: React.FC<{ c: ReturnType<typeof tr> }> = ({ c }) => {
  const chips = ["Shopify", "WooCommerce", "Wix", c.intro.anyStore];
  return (
    <CenterVisual>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", justifyContent: "center", maxWidth: 820 }}>
          {chips.map((p, i) => {
            const isStore = i === 3;
            return (
              <span key={p} style={{ fontFamily: fonts.mono, fontSize: 30, fontWeight: isStore ? 600 : 500, color: isStore ? colors.amber400 : "white", border: `1px solid ${isStore ? `color-mix(in oklch, ${colors.amber400} 55%, transparent)` : "rgba(255,255,255,0.2)"}`, background: isStore ? `color-mix(in oklch, ${colors.amber400} 14%, transparent)` : "rgba(255,255,255,0.06)", padding: "14px 26px", borderRadius: 99 }}>{p}</span>
            );
          })}
        </div>
        <svg width="2" height="70" style={{ margin: "6px 0" }}><line x1="1" y1="0" x2="1" y2="70" stroke="rgba(255,255,255,0.25)" strokeWidth="2" strokeDasharray="5 6" /></svg>
        <div style={{ display: "flex", alignItems: "center", gap: 20, padding: "22px 40px", borderRadius: 26, background: `color-mix(in oklch, ${accent} 16%, ${colors.ink2})`, border: `1px solid color-mix(in oklch, ${accent} 45%, transparent)`, boxShadow: `0 0 50px -12px color-mix(in oklch, ${accent} 70%, transparent)` }}>
          <LogoMark size={70} fill="white" />
          <span style={{ fontSize: 46, fontWeight: 600, color: "white", letterSpacing: "-0.02em" }}>OneShopLab</span>
        </div>
      </div>
    </CenterVisual>
  );
};

// ── card 5 — CTA ────────────────────────────────────────────────────────────
const CardCta: React.FC<{ c: ReturnType<typeof tr> }> = ({ c }) => (
  <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "0 90px" }}>
    <Title size={72}>
      {c.carousel.ctaTitle}
    </Title>
    <div style={{ display: "inline-flex", alignItems: "center", gap: 16, fontSize: 40, fontWeight: 600, color: accentFg, background: accent, padding: "26px 56px", borderRadius: 999, marginTop: 56, boxShadow: `0 20px 60px -14px color-mix(in oklch, ${accent} 70%, transparent)` }}>
      <Sparkle size={38} /> {c.carousel.ctaButton}
    </div>
    <div style={{ marginTop: 40, fontFamily: fonts.mono, fontSize: 28, letterSpacing: "0.06em", color: "rgba(255,255,255,0.72)" }}>
      {c.carousel.ctaSub}
    </div>
  </div>
);

// content vertically centered between the top bar and the bottom caption block
const CenterVisual: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ position: "absolute", left: 0, right: 0, top: 150, bottom: 300, display: "flex", alignItems: "center", justifyContent: "center" }}>
    {children}
  </div>
);

const BottomCaption: React.FC<{ kicker: string; title: string }> = ({ kicker, title }) => (
  <div style={{ position: "absolute", left: 72, right: 72, bottom: 84 }}>
    <Kicker>{kicker}</Kicker>
    <Title size={56}>{title}</Title>
  </div>
);

const tr = (locale: Locale) => I18N[locale];

export const CarouselCard: React.FC<{ locale: Locale; card: number }> = ({ locale, card }) => {
  const c = tr(locale);
  return (
    <Background>
      <TopBar index={card} />
      {card === 1 ? <CardHook c={c} /> : null}
      {card === 2 ? (
        <>
          <CardSeo c={c} />
          <BottomCaption kicker={c.carousel.seoKicker} title={c.carousel.seoTitle} />
        </>
      ) : null}
      {card === 3 ? (
        <>
          <CardPhoto c={c} />
          <BottomCaption kicker={c.carousel.photoKicker} title={c.carousel.photoTitle} />
        </>
      ) : null}
      {card === 4 ? (
        <>
          <CardImport c={c} />
          <BottomCaption kicker={c.carousel.importKicker} title={c.carousel.importTitle} />
        </>
      ) : null}
      {card === 5 ? <CardCta c={c} /> : null}
    </Background>
  );
};
