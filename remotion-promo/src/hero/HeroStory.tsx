import React from "react";
import { AbsoluteFill, Audio, Img, interpolate, random, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { noise2D } from "@remotion/noise";
import { evolvePath } from "@remotion/paths";
import { c, fonts, mix } from "../theme";
import { blink, ease, prog, spr, springs } from "../motion";
import { Grain, Icon, IconName, LOGO_PATHS } from "../components/Ui";
import { ProductTile } from "../scenes/Audit";
import { keystrokes } from "../scenes/Grind";
import { CATALOG } from "../catalog";
import { HERO_SIZE, HeroLoop } from "./HeroLoop";
import T from "./hero-timeline.json";

/**
 * ~30 s hero story, loops: the night grind (pain) → "There's a better way." →
 * the app does it (connect, audit, rewrite, approve, bulk) → morning orders → end card → back to night.
 * Built to read with the sound off (kinetic type); the soundtrack is for the unmute button / sharing.
 */
export const STORY_FRAMES = T.durationInFrames;
const S = T.story;
const A = T.app;
const APP_LEN = S.appTo - S.appFrom;

type Variant = "desktop" | "mobile";

export const HeroStory: React.FC<{ variant: Variant; withAudio?: boolean }> = ({ variant, withAudio = true }) => {
  const f = useCurrentFrame();
  const { width: W, height: H } = useVideoConfig();
  const U = Math.min(W, H) / 1000;

  const bloom = prog(f, S.bloom, S.bloom + 50, ease.outExpo);
  const fadeOut = prog(f, S.fadeOut, STORY_FRAMES - 1, ease.inOut);
  const light = f >= S.bloom;

  return (
    <AbsoluteFill style={{ background: c.night, overflow: "hidden", fontFamily: fonts.sans }}>
      {f < S.bloom + 60 ? <NightBg f={f} /> : null}
      {f < S.bloom + 10 ? <Pain f={f} W={W} H={H} U={U} variant={variant} /> : null}
      {f >= S.freeze - 2 && f < S.bloom + 16 ? <BetterWay f={f} W={W} H={H} U={U} /> : null}

      {light ? (
        <AbsoluteFill style={{ clipPath: bloom < 1 ? `circle(${bloom * Math.hypot(W, H) * 0.6}px at 50% 50%)` : undefined }}>
          <LightBg f={f} />
          {f < S.ctaFrom + 40 ? <AppAct f={f} W={W} H={H} U={U} variant={variant} /> : null}
          {f >= S.appTo - 20 && f < S.ctaFrom + 40 ? <Morning f={f} W={W} H={H} U={U} variant={variant} /> : null}
          {f >= S.ctaFrom - 10 ? <EndCard f={f} U={U} /> : null}
        </AbsoluteFill>
      ) : null}

      <Grain f={f} opacity={light ? 0.06 : 0.18} />
      {fadeOut > 0 ? <AbsoluteFill style={{ background: c.night, opacity: fadeOut }} /> : null}
      {withAudio ? <Audio src={staticFile("audio/hero.wav")} /> : null}
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ backgrounds */

const NightBg: React.FC<{ f: number }> = ({ f }) => {
  const on = prog(f, 0, 40) * (1 - prog(f, S.freeze, S.dotCollapse + 10) * 0.85);
  const x1 = 30 + noise2D("hx", f / 400, 0) * 25;
  const y1 = 70 + noise2D("hy", f / 400, 1) * 12;
  const x2 = 75 + noise2D("hx2", f / 380, 2) * 20;
  return (
    <AbsoluteFill
      style={{
        opacity: on,
        background: `radial-gradient(60% 50% at ${x1}% ${y1}%, ${mix(c.brand800, 55)}, transparent 70%),
          radial-gradient(50% 45% at ${x2}% 20%, ${mix(c.brand700, 28)}, transparent 70%),
          radial-gradient(120% 70% at 50% 115%, ${mix(c.brand900, 90)}, transparent 70%)`,
      }}
    />
  );
};

const LightBg: React.FC<{ f: number }> = ({ f }) => {
  const dawn = prog(f, S.appTo - 20, S.appTo + 40, ease.inOut) * (1 - prog(f, S.ctaFrom - 10, S.ctaFrom + 30, ease.inOut));
  return (
    <AbsoluteFill style={{ background: c.bg }}>
      <AbsoluteFill style={{ background: `radial-gradient(70% 55% at ${50 + noise2D("lb", f / 500, 0) * 8}% 0%, ${mix(c.brand100, 90)}, transparent 70%)` }} />
      <AbsoluteFill
        style={{
          opacity: 0.5,
          backgroundImage: `linear-gradient(${mix(c.brand200, 25)} 1px, transparent 1px), linear-gradient(90deg, ${mix(c.brand200, 25)} 1px, transparent 1px)`,
          backgroundSize: "64px 64px",
          maskImage: "radial-gradient(ellipse 80% 70% at 50% 40%, black, transparent 80%)",
        }}
      />
      {dawn > 0 ? (
        <AbsoluteFill style={{ opacity: dawn, background: `radial-gradient(70% 60% at 50% 110%, ${mix(c.amber300, 85)}, transparent 70%), radial-gradient(50% 40% at 100% 0%, ${mix(c.amber400, 35)}, transparent 70%)` }} />
      ) : null}
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ act 1: the grind */

const CLOCK = ["1:47 AM", "2:13 AM", "2:58 AM", "3:36 AM"];
const HEADLINES = [
  { at: S.pagesFrom, text: "312 product pages." },
  { at: S.titleBeat, text: "Rewrite every title." },
  { at: S.descBeat, text: "Fix every description." },
  { at: S.photoBeat, text: "Redo every photo." },
  { at: S.timesFrom, text: "Now do that 311 more times." },
];
const TITLE_KEYS = [
  { at: S.titleBeat + 6, type: "sneaker white 01", fpc: 3 },
  { at: S.titleBeat + 30, del: 16, fpc: 1 },
  { at: S.titleBeat + 36, type: "White sneakers nice", fpc: 2 },
];
const DESC_KEYS = [
  { at: S.descBeat + 6, type: "Good shoes. Very comfortable.", fpc: 2 },
  { at: S.descBeat + 44, del: 14, fpc: 1 },
];

const Headline: React.FC<{ f: number; U: number; top: number; frozen: boolean }> = ({ f, U, top, frozen }) => {
  const cur = [...HEADLINES].reverse().find((h) => f >= h.at);
  if (!cur) return null;
  const idx = HEADLINES.indexOf(cur);
  const next = HEADLINES[idx + 1];
  const out = next && !frozen ? prog(f, next.at - 8, next.at, ease.inExpo) : 0;
  return (
    <div
      style={{
        position: "absolute",
        top,
        left: 40,
        right: 40,
        textAlign: "center",
        fontWeight: 700,
        fontSize: (cur.at === S.timesFrom ? 76 : 88) * U,
        letterSpacing: "-0.045em",
        lineHeight: 1.05,
        color: cur.at === S.timesFrom ? "oklch(0.8 0.14 40)" : c.nightFg,
        textShadow: "0 4px 30px rgba(0,0,0,0.9)",
        opacity: 1 - out,
        transform: `translateY(${-out * 40 * U}px)`,
      }}
    >
      {cur.text.split(" ").map((w, i) => {
        const t = spr(f, cur.at + i * 4, springs.snappy);
        return (
          <span key={i} style={{ display: "inline-block", overflow: "hidden", verticalAlign: "bottom", paddingBottom: 8 * U, marginRight: 22 * U }}>
            <span style={{ display: "inline-block", transform: `translateY(${(1 - t) * 110}%)` }}>{w}</span>
          </span>
        );
      })}
    </div>
  );
};

const Pain: React.FC<{ f: number; W: number; H: number; U: number; variant: Variant }> = ({ f: raw, W, H, U, variant }) => {
  const f = Math.min(raw, S.freeze);
  const frozen = raw >= S.freeze;
  const collapse = prog(raw, S.freeze + 4, S.dotCollapse + 4, ease.inExpo);
  const chaos = prog(f, S.titleBeat + 40, S.freeze, ease.inOut);
  const shake = { x: noise2D("px", f / 6, 0) * 12 * chaos * U, y: noise2D("py", f / 6, 1) * 10 * chaos * U, r: noise2D("pr", f / 12, 2) * 1.1 * chaos };

  // the big clock, then the chip
  const clockIn = prog(f, 4, 50, ease.outExpo);
  const clockToChip = prog(f, S.pagesFrom - 14, S.pagesFrom + 16, ease.inOut);
  const jumps = S.clockJumps.filter((j) => f >= j).length;
  const lastJump = jumps ? S.clockJumps[jumps - 1] : -99;
  const flip = prog(f, lastJump, lastJump + 14, ease.outBack);

  const mobile = variant === "mobile";
  const headTop = (mobile ? 150 : 110) * U;
  const widgetW = Math.min(W - 80, 780 * U);
  const widgetTop = H * (mobile ? 0.42 : 0.38);

  return (
    <AbsoluteFill
      style={{
        transform: `translate(${shake.x}px, ${shake.y}px) rotate(${shake.r}deg) scale(${1 - collapse * 0.985})`,
        filter: `saturate(${frozen ? 0.25 : 1}) blur(${collapse * 6}px)`,
        opacity: 1 - prog(raw, S.dotCollapse - 4, S.dotCollapse + 6),
      }}
    >
      {/* big clock + line (opening) */}
      {clockToChip < 1 ? (
        <div style={{ position: "absolute", left: 0, right: 0, top: H * 0.3, textAlign: "center", opacity: 1 - clockToChip, transform: `translateY(${-clockToChip * 80 * U}px) scale(${1 - clockToChip * 0.2})` }}>
          <div style={{ fontWeight: 200, fontSize: 210 * U, letterSpacing: "-0.05em", color: c.nightFg, opacity: clockIn, filter: `blur(${(1 - clockIn) * 20}px)`, lineHeight: 1, textShadow: "0 0 80px rgba(120,160,255,0.25)" }}>1:47</div>
          <div style={{ marginTop: 26 * U, fontSize: 34 * U, color: "oklch(0.75 0.02 250)", opacity: prog(f, 36, 60) }}>
            Sam is still up. <span style={{ color: c.nightFg }}>The store still isn&apos;t selling.</span>
          </div>
        </div>
      ) : null}
      {/* clock chip */}
      <div
        style={{
          position: "absolute",
          left: 36 * U,
          top: 30 * U,
          opacity: prog(f, S.pagesFrom, S.pagesFrom + 20),
          display: "flex",
          alignItems: "center",
          gap: 10 * U,
          fontFamily: fonts.mono,
          fontSize: 26 * U,
          fontWeight: 500,
          padding: `${10 * U}px ${18 * U}px`,
          borderRadius: 999,
          color: jumps >= 2 ? "oklch(0.8 0.14 40)" : c.nightFg,
          background: jumps >= 2 ? mix(c.danger, 22) : "rgba(255,255,255,0.08)",
          transform: `perspective(400px) rotateX(${(1 - flip) * 80}deg)`,
        }}
      >
        <Icon name="moon" size={24 * U} stroke={2.2} />
        {CLOCK[jumps]}
      </div>

      <Headline f={f} U={U} top={headTop} frozen={frozen} />

      {/* the pile of pages */}
      <Pile f={f} W={W} H={H} U={U} mobile={mobile} />

      {/* work widgets */}
      {f >= S.titleBeat - 6 && f < S.timesFrom + 6 ? (
        <div
          style={{
            position: "absolute",
            left: (W - widgetW) / 2,
            top: widgetTop,
            width: widgetW,
            padding: 34 * U,
            borderRadius: 30 * U,
            background: c.night2,
            border: "1.5px solid rgba(255,255,255,0.1)",
            boxShadow: "0 50px 100px -30px rgba(0,0,0,0.8)",
            opacity: prog(f, S.titleBeat - 6, S.titleBeat + 8) * (1 - prog(f, S.timesFrom - 6, S.timesFrom + 6)),
            transform: `scale(${0.94 + spr(f, S.titleBeat - 6, springs.snappy) * 0.06})`,
          }}
        >
          <Widget f={f} U={U} />
        </div>
      ) : null}

      {/* keycaps: the copy-paste loop */}
      {T.keycaps.filter((k) => f >= k).map((k, i) => {
        const s = spr(f, k, springs.bouncy);
        const life = 1 - prog(f, k + 16, k + 30, ease.inOut);
        const side = i % 2 ? 1 : -1;
        const x = W / 2 + side * (W * 0.3 + random(`kx${k}`) * W * 0.12) - 60 * U;
        const y = H * (0.25 + random(`ky${k}`) * 0.6);
        return (
          <div
            key={k}
            style={{
              position: "absolute",
              left: Math.min(W - 150 * U, Math.max(20, x)),
              top: y,
              transform: `scale(${s}) rotate(${(random(`kr${k}`) - 0.5) * 20}deg)`,
              opacity: life,
              fontWeight: 600,
              fontSize: 40 * U,
              color: c.nightFg,
              padding: `${14 * U}px ${22 * U}px`,
              borderRadius: 18 * U,
              background: "linear-gradient(180deg, oklch(0.32 0.03 250), oklch(0.22 0.025 250))",
              border: "1.5px solid rgba(255,255,255,0.14)",
              boxShadow: "0 7px 0 oklch(0.14 0.02 250), 0 20px 36px rgba(0,0,0,0.5)",
            }}
          >
            {["⌘C", "⌘V", "⌘Z"][i % 3]}
          </div>
        );
      })}

      {/* the wall: 312 pages */}
      {f >= S.timesFrom ? <Wall f={f} W={W} H={H} U={U} /> : null}

      <AbsoluteFill style={{ background: `radial-gradient(ellipse ${interpolate(chaos, [0, 1], [95, 62])}% ${interpolate(chaos, [0, 1], [85, 60])}% at 50% 50%, transparent 55%, rgba(0,0,0,0.7))` }} />
    </AbsoluteFill>
  );
};

const Pile: React.FC<{ f: number; W: number; H: number; U: number; mobile: boolean }> = ({ f, W, H, U, mobile }) => {
  if (f < S.pagesFrom) return null;
  const tw = 230 * U;
  const th = 250 * U;
  const back = prog(f, S.titleBeat - 10, S.titleBeat + 20, ease.inOut); // pushed back once the work starts
  const cy = H * (mobile ? 0.56 : 0.58);
  return (
    <>
      {CATALOG.map((p, i) => {
        const s = spr(f, S.pagesFrom + 10 + i * 5, springs.snappy);
        const k = i - 4;
        const spread = mobile ? 62 : 110;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: W / 2 - tw / 2 + k * spread * U * (1 - back * 0.3),
              top: cy - th / 2 + Math.abs(k) * 14 * U + (1 - s) * 260 * U + back * 120 * U,
              width: tw,
              height: th,
              transform: `rotate(${k * 5 * (1 - back * 0.4)}deg) scale(${1 - back * 0.12})`,
              opacity: Math.min(1, s * 1.4) * (1 - back * 0.72),
              filter: back > 0 ? `blur(${back * 3}px)` : undefined,
              zIndex: 10 - Math.abs(k),
            }}
          >
            <ProductTile p={p} score={p.score * prog(f, S.pagesFrom + 40 + i * 4, S.pagesFrom + 60 + i * 4)} imgH={130 * U} />
          </div>
        );
      })}
    </>
  );
};

const Widget: React.FC<{ f: number; U: number }> = ({ f, U }) => {
  const label = (t: string) => <div style={{ fontFamily: fonts.mono, fontSize: 20 * U, letterSpacing: "0.14em", color: "oklch(0.7 0.02 250)", marginBottom: 12 * U }}>{t}</div>;
  const field: React.CSSProperties = { fontSize: 36 * U, color: c.nightFg, padding: `${22 * U}px ${24 * U}px`, borderRadius: 18 * U, background: "rgba(255,255,255,0.05)", border: `2px solid ${mix(c.brand500, 70)}`, minHeight: 44 * U };
  if (f < S.descBeat) {
    return (
      <>
        {label("TITLE")}
        <div style={field}>
          {keystrokes(TITLE_KEYS, f)}
          <span style={{ color: c.brand300, opacity: blink(f) }}>|</span>
        </div>
      </>
    );
  }
  if (f < S.photoBeat) {
    return (
      <>
        {label("DESCRIPTION")}
        <div style={{ ...field, minHeight: 150 * U, fontSize: 32 * U, lineHeight: 1.45 }}>
          {keystrokes(DESC_KEYS, f)}
          <span style={{ color: c.brand300, opacity: blink(f) }}>|</span>
        </div>
      </>
    );
  }
  // photo: crop handles hunting for a better frame, brightness slider nudged back and forth
  const crop = 0.08 + Math.abs(noise2D("crop", f / 20, 0)) * 0.14;
  const slider = 0.5 + noise2D("sl", f / 15, 1) * 0.35;
  const size = 300 * U;
  return (
    <div style={{ display: "flex", gap: 30 * U, alignItems: "center" }}>
      <div style={{ position: "relative", width: size, height: size, borderRadius: 18 * U, overflow: "hidden", flexShrink: 0 }}>
        <Img src={staticFile("img/sneaker-raw.png")} style={{ width: "100%", height: "100%", objectFit: "cover", filter: `brightness(${0.8 + slider * 0.4}) saturate(0.8)` }} />
        <div style={{ position: "absolute", inset: `${crop * 100}%`, border: "3px dashed rgba(255,255,255,0.85)", boxShadow: "0 0 0 999px rgba(0,0,0,0.45)" }} />
      </div>
      <div style={{ flex: 1 }}>
        {label("IMAGE")}
        <div style={{ fontSize: 30 * U, color: "oklch(0.85 0.01 250)", marginBottom: 26 * U }}>sneaker-raw-final-v3.jpg</div>
        <div style={{ fontSize: 22 * U, color: "oklch(0.7 0.02 250)", marginBottom: 12 * U }}>Brightness</div>
        <div style={{ position: "relative", height: 8 * U, borderRadius: 99, background: "rgba(255,255,255,0.12)" }}>
          <div style={{ position: "absolute", left: `${slider * 100}%`, top: "50%", width: 30 * U, height: 30 * U, borderRadius: 99, background: c.nightFg, transform: "translate(-50%, -50%)" }} />
        </div>
      </div>
    </div>
  );
};

const Wall: React.FC<{ f: number; W: number; H: number; U: number }> = ({ f, W, H, U }) => {
  const cell = 64 * U;
  const cols = Math.ceil(W / cell);
  const rows = Math.ceil(H / cell);
  const n = cols * rows;
  const shown = Math.floor(prog(f, S.timesFrom, S.freeze - 4, ease.inOut) * n);
  const cells = [];
  for (let i = 0; i < n; i++) {
    const order = Math.floor(random(`w${i}`) * n);
    if (order >= shown) continue;
    const p = CATALOG[i % CATALOG.length];
    cells.push(
      <div key={i} style={{ position: "absolute", left: (i % cols) * cell + 3, top: Math.floor(i / cols) * cell + 3, width: cell - 6, height: cell - 6, borderRadius: 10 * U, overflow: "hidden", opacity: 0.4, outline: `2px solid ${mix(c.danger, 55)}` }}>
        <Img src={staticFile(p.img)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>,
    );
  }
  return (
    <AbsoluteFill style={{ zIndex: -1 }}>
      {cells}
      <AbsoluteFill style={{ background: `radial-gradient(70% 30% at 50% 12%, ${c.night} 30%, transparent 100%)` }} />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ act 2: the dot */

const BetterWay: React.FC<{ f: number; W: number; H: number; U: number }> = ({ f, W, H, U }) => {
  const dotIn = spr(f, S.dotCollapse - 2, springs.bouncy);
  const inhale = prog(f, S.bloom - 30, S.bloom - 6, ease.inOut);
  const burst = prog(f, S.bloom - 6, S.bloom + 10, ease.inExpo);
  const pulse = 1 + Math.sin((f - S.dotCollapse) / 9) * 0.06 * (1 - inhale);
  const textOut = prog(f, S.bloom - 34, S.bloom - 8, ease.inOut);
  const words = ["There's", "a", "better", "way."];
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: W / 2 - 20 * U,
          top: H * 0.42 - 20 * U,
          width: 40 * U,
          height: 40 * U,
          borderRadius: 99,
          background: c.brand500,
          boxShadow: `0 0 40px 10px ${c.brand500}, 0 0 120px 40px ${mix(c.brand500, 35)}`,
          transform: `scale(${dotIn * pulse * (1 - inhale * 0.35) * (1 + burst * 6)})`,
          opacity: 1 - prog(f, S.bloom - 2, S.bloom + 10),
        }}
      />
      <div style={{ position: "absolute", top: H * 0.42 + 80 * U, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 24 * U, fontWeight: 500, fontSize: 92 * U, letterSpacing: "-0.035em", color: c.nightFg, opacity: 1 - textOut, filter: `blur(${textOut * 12}px)` }}>
        {words.map((w, i) => {
          const t = prog(f, S.betterWay + i * 9, S.betterWay + i * 9 + 24, ease.outExpo);
          return (
            <span key={w} style={{ display: "inline-block", opacity: t, filter: `blur(${(1 - t) * 16}px)`, transform: `translateY(${(1 - t) * 40 * U}px)` }}>
              {w}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ act 3: the app */

const STEPS = [
  { at: 0, n: 1, text: "Connect your Shopify, WooCommerce or Wix store." },
  { at: A.tilesFrom + 10, n: 2, text: "Every product scored in about a minute." },
  { at: A.gen - 10, n: 3, text: "The AI rewrites titles, descriptions and photos." },
  { at: A.approve - 4, n: 4, text: "You approve. It's live on your store." },
  { at: A.bulkClick - 6, n: 5, text: "Your whole catalog. One click." },
];

const windowRect = (W: number, variant: Variant) => {
  const app = HERO_SIZE[variant];
  const scale = 0.84;
  const w = app.w * scale;
  return { left: (W - w) / 2, top: 28, scale, w, h: app.h * scale, captionTop: 28 + app.h * scale + (variant === "desktop" ? 34 : 40) };
};

const AppAct: React.FC<{ f: number; W: number; H: number; U: number; variant: Variant }> = ({ f, W, H, U, variant }) => {
  const r = windowRect(W, variant);
  const local = Math.min(f - S.appFrom, APP_LEN - 1);
  const enter = spr(f, S.bloom - 4, springs.soft);
  const morningDim = prog(f, S.appTo - 10, S.appTo + 30, ease.inOut);
  const exit = prog(f, S.ctaFrom - 16, S.ctaFrom + 20, ease.inExpo);

  const step = [...STEPS].reverse().find((s) => local >= s.at) ?? STEPS[0];
  const stepIn = spr(f, S.appFrom + step.at, springs.snappy);
  const captionOut = prog(f, S.appTo - 16, S.appTo);

  return (
    <AbsoluteFill style={{ opacity: 1 - exit, transform: `translateY(${-exit * 80}px) scale(${1 - exit * 0.06})`, filter: exit > 0 ? `blur(${exit * 12}px)` : undefined }}>
      <div
        style={{
          position: "absolute",
          left: r.left,
          top: r.top,
          width: r.w,
          height: r.h,
          borderRadius: 26,
          overflow: "hidden",
          border: `1.5px solid ${c.border}`,
          boxShadow: `0 50px 120px -40px ${mix(c.brand900, 45)}, 0 10px 30px -20px ${mix(c.eclipse, 30)}`,
          transform: `scale(${0.92 + enter * 0.08})`,
          filter: morningDim > 0 ? `blur(${morningDim * 3}px) saturate(${1 - morningDim * 0.3})` : undefined,
          opacity: 1 - morningDim * 0.55,
        }}
      >
        <div style={{ width: HERO_SIZE[variant].w, height: HERO_SIZE[variant].h, transform: `scale(${r.scale})`, transformOrigin: "top left" }}>
          <HeroLoop variant={variant} frame={Math.max(0, local)} />
        </div>
      </div>

      {/* step caption */}
      <div style={{ position: "absolute", left: 40, right: 40, top: r.captionTop, display: "flex", justifyContent: "center", opacity: (1 - captionOut) * prog(f, S.bloom + 10, S.bloom + 30) }}>
        <div key={step.n} style={{ display: "flex", alignItems: "center", gap: 16 * U, transform: `translateY(${(1 - stepIn) * 24 * U}px)`, opacity: Math.min(1, stepIn * 1.5) }}>
          <span style={{ width: 46 * U, height: 46 * U, borderRadius: 99, background: c.brand500, color: "white", fontFamily: fonts.mono, fontWeight: 600, fontSize: 24 * U, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{step.n}</span>
          <span style={{ fontWeight: 600, fontSize: (variant === "desktop" ? 36 : 40) * U, letterSpacing: "-0.02em", color: c.eclipse }}>{step.text}</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ act 4: morning */

const ORDERS: { app: string; icon: IconName; bg: string; title: string; body: string }[] = [
  { app: "Sam's Goods", icon: "bag", bg: `linear-gradient(135deg, ${c.brand400}, ${c.brand600})`, title: "New order #1048 · $129", body: "Off-White Leather High-Top Sneaker" },
  { app: "Sam's Goods", icon: "bag", bg: `linear-gradient(135deg, ${c.brand400}, ${c.brand600})`, title: "New order #1049 · $249", body: "Skeleton Automatic Watch" },
  { app: "Sam's Goods", icon: "bag", bg: `linear-gradient(135deg, ${c.brand400}, ${c.brand600})`, title: "New order #1050 · $89", body: "Tortoiseshell Sunglasses" },
  { app: "Mom", icon: "heart", bg: "linear-gradient(135deg, oklch(0.72 0.17 15), oklch(0.62 0.2 0))", title: "You slept!", body: "Proud of you." },
];

const Morning: React.FC<{ f: number; W: number; H: number; U: number; variant: Variant }> = ({ f, W, H, U, variant }) => {
  const exit = prog(f, S.ctaFrom - 16, S.ctaFrom + 16, ease.inExpo);
  const cardW = variant === "desktop" ? 620 * U : W - 120;
  const cardH = 130 * U;
  const gap = 16 * U;
  const left = (W - cardW) / 2;
  const top = variant === "desktop" ? H * 0.3 : H * 0.3;
  const arrived = ORDERS.map((o, i) => ({ ...o, at: S.ordersFrom + i * S.orderStep + (o.app === "Mom" ? 14 : 0) })).filter((o) => f >= o.at);
  const time = prog(f, S.appTo, S.appTo + 30);
  return (
    <AbsoluteFill style={{ opacity: 1 - exit, filter: exit > 0 ? `blur(${exit * 10}px)` : undefined }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: top - 250 * U, textAlign: "center", opacity: time, transform: `translateY(${(1 - time) * 20}px)` }}>
        <div style={{ fontWeight: 300, fontSize: 120 * U, letterSpacing: "-0.05em", color: c.eclipse, lineHeight: 1 }}>7:30</div>
        <div style={{ fontSize: 30 * U, color: c.muted, marginTop: 6 * U }}>Sam wakes up to this.</div>
      </div>
      {arrived.map((o, idx) => {
        const order = arrived.length - 1 - idx;
        const inS = spr(f, o.at + 6, springs.snappy);
        const y = arrived.slice(idx + 1).reduce((acc, later) => acc + spr(f, later.at, springs.heavy) * (cardH + gap), 0);
        return (
          <div
            key={o.at}
            style={{
              position: "absolute",
              left,
              top: top + y,
              width: cardW,
              height: cardH,
              borderRadius: 34 * U,
              background: "rgba(255,255,255,0.78)",
              border: "1.5px solid rgba(255,255,255,0.9)",
              backdropFilter: "blur(24px) saturate(1.4)",
              boxShadow: `0 24px 60px -24px ${mix(c.brand900, 40)}`,
              display: "flex",
              alignItems: "center",
              gap: 22 * U,
              padding: `0 ${26 * U}px`,
              transform: `translateY(${(1 - inS) * -40 * U}px) scale(${0.9 + inS * 0.1})`,
              opacity: Math.min(1, inS * 1.4),
              zIndex: 10 - order,
            }}
          >
            <div style={{ width: 70 * U, height: 70 * U, borderRadius: 20 * U, background: o.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon name={o.icon} size={38 * U} color="white" stroke={2.2} />
            </div>
            <div style={{ flex: 1, minWidth: 0, color: c.eclipse }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 600, fontSize: 28 * U }}>{o.app}</span>
                <span style={{ fontSize: 22 * U, color: c.muted }}>now</span>
              </div>
              <div style={{ fontWeight: 600, fontSize: 25 * U, marginTop: 2 }}>{o.title}</div>
              <div style={{ fontSize: 25 * U, color: c.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.body}</div>
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ end card */

const EndCard: React.FC<{ f: number; U: number }> = ({ f, U }) => {
  const draw = prog(f, S.logoDraw, S.logoDraw + 44, ease.inOut);
  const fill = prog(f, S.logoDraw + 30, S.logoDraw + 56, ease.inOut);
  const url = spr(f, S.url, springs.bouncy);
  const size = 150 * U;
  const lines = [
    { text: "Connect your store.", at: S.tagline, grad: false },
    { text: "The AI does the rest.", at: S.tagline + 16, grad: true },
  ];
  return (
    <AbsoluteFill style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 22 * U, opacity: prog(f, S.ctaFrom - 10, S.ctaFrom + 10) }}>
      <svg width={size} height={size} viewBox="0 0 500 500" style={{ transform: `scale(${0.85 + spr(f, S.logoDraw, springs.soft) * 0.15})` }}>
        {LOGO_PATHS.map((d, i) => {
          const ev = evolvePath(prog(draw, i * 0.25, 1, ease.inOut), d);
          return <path key={i} d={d} fill={c.brand500} fillOpacity={fill} stroke={c.brand500} strokeWidth={6} strokeDasharray={ev.strokeDasharray} strokeDashoffset={ev.strokeDashoffset} />;
        })}
      </svg>
      <div style={{ textAlign: "center", fontWeight: 700, fontSize: 72 * U, letterSpacing: "-0.04em", lineHeight: 1.08 }}>
        {lines.map((l) => {
          const t = spr(f, l.at, springs.snappy);
          return (
            <div key={l.text} style={{ overflow: "hidden", paddingBottom: 6 * U }}>
              <div
                style={{
                  transform: `translateY(${(1 - t) * 105}%)`,
                  color: l.grad ? "transparent" : c.eclipse,
                  backgroundImage: l.grad ? `linear-gradient(90deg, ${c.brand600}, ${c.brand400}, ${c.brand600})` : undefined,
                  backgroundSize: "200% 100%",
                  backgroundPosition: `${100 - prog(f, l.at, STORY_FRAMES, ease.inOut) * 100}% 0`,
                  WebkitBackgroundClip: l.grad ? "text" : undefined,
                  backgroundClip: l.grad ? "text" : undefined,
                }}
              >
                {l.text}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 10 * U, display: "flex", alignItems: "center", gap: 14 * U, padding: `${22 * U}px ${40 * U}px`, borderRadius: 999, background: c.brand500, color: "white", fontWeight: 600, fontSize: 34 * U, transform: `scale(${url})`, boxShadow: `0 24px 50px -20px ${mix(c.brand500, 75)}` }}>
        Free audit · oneshoplab.com
        <Icon name="arrowRight" size={32 * U} color="white" stroke={2.4} />
      </div>
    </AbsoluteFill>
  );
};
