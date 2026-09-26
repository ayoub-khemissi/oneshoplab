import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile } from "remotion";
import { noise2D } from "@remotion/noise";
import { c, fonts, mix } from "../theme";
import { CUE, S, blink, ease, prog, spr, springs } from "../motion";
import { jitter } from "../components/Ui";

type Key = { at: number; type?: string; del?: number; fpc?: number };

/** Replays a keystroke script (type / backspace) up to frame f. */
export const keystrokes = (script: Key[], f: number) => {
  let s = "";
  for (const k of script) {
    if (f < k.at) break;
    const fpc = k.fpc ?? 3;
    const n = Math.floor((f - k.at) / fpc);
    if (k.type) s += k.type.slice(0, n);
    if (k.del) s = s.slice(0, Math.max(0, s.length - Math.min(k.del, n)));
  }
  return s;
};

const TITLE: Key[] = [
  { at: CUE.grindTypingFrom, type: "sneaker white", fpc: 3 },
  { at: 450, del: 13, fpc: 1 },
  { at: 468, type: "White sneakers nice comfy", fpc: 3 },
  { at: 548, del: 11, fpc: 1 },
  { at: 566, type: " - best quality!!", fpc: 3 },
  { at: 630, del: 17, fpc: 1 },
  { at: 652, type: " (leather)", fpc: 4 },
];
const DESC: Key[] = [
  { at: 430, type: "Good shoes. Very comfortable.", fpc: 3 },
  { at: 540, type: " Buy now", fpc: 4 },
  { at: 600, del: 8, fpc: 2 },
  { at: 640, type: " Great for walking", fpc: 3 },
];

const TABS = [
  "Product 47 · Edit",
  "Keyword ideas",
  "Photo editor",
  "Product 48 · Edit",
  "Untitled doc",
  "How to write a product description",
  "Product 49 · Edit",
  "Background remover",
  "Product 50 · Edit",
];
const CLOCK = ["1:47 AM", "2:13 AM", "2:58 AM", "3:36 AM"];
const KEYCAPS = [
  { at: 420, label: "⌘C", x: 830, y: 330 },
  { at: 470, label: "⌘V", x: 90, y: 700 },
  { at: 510, label: "⌘Z", x: 840, y: 980 },
  { at: 545, label: "⌘C", x: 120, y: 1180 },
  { at: 575, label: "⌘V", x: 800, y: 560 },
  { at: 600, label: "⌘Z", x: 60, y: 420 },
  { at: 622, label: "⌘C", x: 840, y: 1260 },
  { at: 642, label: "⌘V", x: 420, y: 250 },
  { at: 660, label: "⌘Z", x: 140, y: 930 },
  { at: 676, label: "⌘C", x: 760, y: 1140 },
  { at: 690, label: "⌘V", x: 300, y: 1330 },
  { at: 702, label: "⌘Z", x: 840, y: 760 },
];

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontFamily: fonts.mono, fontSize: 22, letterSpacing: "0.14em", color: "oklch(0.7 0.02 250)", marginBottom: 12 }}>{children}</div>
);

/** 1:47 → 3:36. One product page at a time, by hand. Tabs pile up, the clock jumps, it shakes. */
export const Grind: React.FC<{ f: number }> = ({ f: raw }) => {
  // After the freeze everything holds still (the Pause scene collapses it).
  const f = Math.min(raw, CUE.freeze);
  const enter = prog(raw, S.grind.from - 20, S.grind.from + 30, ease.outExpo);
  const chaos = prog(f, 520, CUE.freeze, ease.inOut);
  const shakeX = noise2D("gx", f / 6, 0) * 12 * chaos;
  const shakeY = noise2D("gy", f / 6, 1) * 10 * chaos;
  const rot = noise2D("gr", f / 12, 2) * 1.2 * chaos;
  const zoom = 1 + prog(f, S.grind.from, CUE.freeze, ease.inOut) * 0.08;

  // Collapse into the dot (handled here so the window itself shrinks away).
  const collapse = prog(raw, CUE.freeze + 8, CUE.dotCollapse + 4, ease.inExpo);
  const frozenTint = prog(raw, CUE.freeze, CUE.freeze + 10, ease.outExpo);

  const clockIdx = CUE.clockJumps.filter((j) => f >= j).length;
  const lastJump = clockIdx > 0 ? CUE.clockJumps[clockIdx - 1] : -100;
  const flip = prog(f, lastJump, lastJump + 14, ease.outBack);
  const tabsShown = Math.min(TABS.length, 2 + Math.floor(Math.max(0, f - 400) / 34));
  const productN = 47 + CUE.clockJumps.filter((j) => f >= j + 10).length;
  const title = keystrokes(TITLE, f);
  const desc = keystrokes(DESC, f);
  const ghosts = [500, 580, 650].filter((g) => f >= g);

  const win: React.CSSProperties = {
    position: "absolute",
    left: 40,
    right: 40,
    top: 250,
    height: 1130,
    borderRadius: 36,
    background: c.night2,
    border: "1.5px solid rgba(255,255,255,0.08)",
    boxShadow: "0 60px 120px -30px rgba(0,0,0,0.7)",
    overflow: "hidden",
  };

  return (
    <AbsoluteFill
      style={{
        opacity: enter * (1 - prog(raw, CUE.dotCollapse - 6, CUE.dotCollapse + 4)),
        transform: `translate(${shakeX}px, ${shakeY}px) rotate(${rot}deg) scale(${(0.9 + enter * 0.1) * zoom * (1 - collapse * 0.985)})`,
        transformOrigin: "50% 45%",
        filter: `blur(${(1 - enter) * 20 + collapse * 8}px) saturate(${1 - frozenTint * 0.8})`,
      }}
    >
      {/* the pile of pages still to do */}
      {ghosts.map((g, i) => {
        const t = spr(f, g, springs.soft);
        const depth = ghosts.length - i;
        return <div key={g} style={{ ...win, transform: `translateY(${-depth * 26 * t}px) scale(${1 - depth * 0.035})`, opacity: 0.45 * t, background: c.night2 }} />;
      })}

      <div style={win}>
        {/* tab strip */}
        <div style={{ display: "flex", gap: 8, padding: "20px 20px 0", height: 76, background: "rgba(255,255,255,0.03)" }}>
          {TABS.slice(0, tabsShown).map((t, i) => {
            const s = spr(f, 400 + (i - 2) * 34, springs.snappy);
            const active = i === tabsShown - 1;
            return (
              <div
                key={t}
                style={{
                  flex: `${i < 2 ? 1 : s} 1 0`,
                  minWidth: 0,
                  padding: "14px 18px",
                  borderRadius: "16px 16px 0 0",
                  background: active ? c.night2 : "rgba(255,255,255,0.05)",
                  color: active ? c.nightFg : "oklch(0.65 0.02 250)",
                  fontFamily: fonts.sans,
                  fontSize: 22,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  opacity: i < 2 ? 1 : s,
                }}
              >
                {t}
              </div>
            );
          })}
        </div>

        <div style={{ padding: "40px 48px", display: "flex", flexDirection: "column", gap: 34 }}>
          {/* header: counter + clock */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontFamily: fonts.sans, color: c.nightFg }}>
              <div style={{ fontSize: 26, opacity: 0.55 }}>Products</div>
              <div style={{ fontSize: 50, fontWeight: 600, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
                {productN} <span style={{ opacity: 0.4, fontWeight: 400 }}>of 312</span>
              </div>
            </div>
            <div
              style={{
                fontFamily: fonts.mono,
                fontSize: 34,
                fontWeight: 500,
                padding: "14px 24px",
                borderRadius: 999,
                color: clockIdx >= 2 ? "oklch(0.8 0.14 40)" : c.nightFg,
                background: clockIdx >= 2 ? mix(c.danger, 22) : "rgba(255,255,255,0.08)",
                transform: `perspective(400px) rotateX(${(1 - flip) * 80}deg)`,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {CLOCK[clockIdx]}
            </div>
          </div>
          <div style={{ height: 8, borderRadius: 99, background: "rgba(255,255,255,0.08)" }}>
            <div style={{ height: "100%", width: `${(productN / 312) * 100}%`, borderRadius: 99, background: c.brand500 }} />
          </div>

          <div>
            <Label>TITLE</Label>
            <div style={{ fontFamily: fonts.sans, fontSize: 40, color: c.nightFg, padding: "26px 28px", borderRadius: 20, background: "rgba(255,255,255,0.05)", border: `2px solid ${mix(c.brand500, 70)}`, minHeight: 50 }}>
              {title}
              <span style={{ opacity: blink(f), color: c.brand300 }}>|</span>
            </div>
          </div>

          <div>
            <Label>DESCRIPTION</Label>
            <div style={{ fontFamily: fonts.sans, fontSize: 34, lineHeight: 1.45, color: "oklch(0.85 0.01 250)", padding: "26px 28px", borderRadius: 20, background: "rgba(255,255,255,0.05)", border: "1.5px solid rgba(255,255,255,0.1)", height: 190 }}>
              {desc}
            </div>
          </div>

          <div>
            <Label>IMAGES</Label>
            <div style={{ display: "flex", gap: 20 }}>
              <div style={{ width: 250, height: 250, borderRadius: 22, overflow: "hidden", filter: "saturate(0.7) brightness(0.9)" }}>
                <Img src={staticFile("img/sneaker-raw.png")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
              {[0, 1].map((i) => (
                <div key={i} style={{ width: 250, height: 250, borderRadius: 22, border: "2.5px dashed rgba(255,255,255,0.16)", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.3)", fontFamily: fonts.sans, fontSize: 60, fontWeight: 200 }}>
                  +
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* keycaps: the copy-paste loop */}
      {KEYCAPS.filter((k) => f >= k.at).map((k) => {
        const s = spr(f, k.at, springs.bouncy);
        const life = 1 - prog(f, k.at + 18, k.at + 34, ease.inOut);
        return (
          <div
            key={k.at}
            style={{
              position: "absolute",
              left: k.x,
              top: k.y,
              transform: `scale(${s * (0.9 + life * 0.1)}) rotate(${jitter(k.at, 10)}deg)`,
              opacity: life,
              fontFamily: fonts.sans,
              fontWeight: 600,
              fontSize: 46,
              color: c.nightFg,
              padding: "18px 26px",
              borderRadius: 22,
              background: "linear-gradient(180deg, oklch(0.32 0.03 250), oklch(0.22 0.025 250))",
              border: "1.5px solid rgba(255,255,255,0.14)",
              boxShadow: "0 8px 0 oklch(0.14 0.02 250), 0 24px 40px rgba(0,0,0,0.5)",
            }}
          >
            {k.label}
          </div>
        );
      })}

      {/* vignette tightening with fatigue */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse ${interpolate(chaos, [0, 1], [95, 60])}% ${interpolate(chaos, [0, 1], [80, 55])}% at 50% 45%, transparent 55%, rgba(0,0,0,0.75))`,
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};
