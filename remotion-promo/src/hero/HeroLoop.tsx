import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { c, fonts, mix } from "../theme";
import { blink, ease, lerp, prog, spr, springs, typed } from "../motion";
import { Cursor, Eyebrow, Icon, LogoMark, PlatformChip } from "../components/Ui";
import { DETAIL, ProductDetail } from "../components/ProductDetail";
import { ProductTile, ScoreRing } from "../scenes/Audit";
import { AVG_AFTER, AVG_BEFORE, CATALOG } from "../catalog";
import heroTimeline from "./hero-timeline.json";

/**
 * Silent 14 s product loop for the landing hero (scenario A, "the catalog that fixes itself").
 * Last frame = first frame (the empty URL field), so it loops without a seam.
 */
export const HERO_FRAMES = 840;
export const HERO_SIZE = { desktop: { w: 1600, h: 1000 }, mobile: { w: 1080, h: 1350 } } as const;

const H = heroTimeline.app;
const BULK_END = H.bulkFrom + 8 * H.bulkStep + 30;
const URL = "samsgoods.com";

type Layout = {
  w: number;
  h: number;
  header: number;
  pad: number;
  grid: { x: number; y: number; cols: number; w: number; h: number; gap: number; imgH: number };
  gridHead: { x: number; y: number; w: number };
  detail: { x: number; y: number; scale: number; sheet: boolean };
  ui: number; // type scale
  touch: boolean;
};

const DESKTOP: Layout = {
  w: 1600,
  h: 1000,
  header: 72,
  pad: 32,
  grid: { x: 32, y: 204, cols: 3, w: 280, h: 241, gap: 20, imgH: 118 },
  gridHead: { x: 32, y: 100, w: 880 },
  detail: { x: 944, y: 100, scale: 0.624, sheet: false },
  ui: 1,
  touch: false,
};

const MOBILE: Layout = {
  w: 1080,
  h: 1350,
  header: 96,
  pad: 36,
  grid: { x: 36, y: 290, cols: 3, w: 316, h: 320, gap: 20, imgH: 180 },
  gridHead: { x: 36, y: 130, w: 1008 },
  detail: { x: 100, y: 140, scale: 0.88, sheet: true },
  ui: 1.3,
  touch: true,
};

const tileRect = (L: Layout, i: number) => ({
  left: L.grid.x + (i % L.grid.cols) * (L.grid.w + L.grid.gap),
  top: L.grid.y + Math.floor(i / L.grid.cols) * (L.grid.h + L.grid.gap),
  width: L.grid.w,
  height: L.grid.h,
});

/** Piecewise pointer path: [frame, x, y] keys, eased between. */
const pathAt = (f: number, keys: [number, number, number][]) => {
  if (f <= keys[0][0]) return { x: keys[0][1], y: keys[0][2] };
  for (let i = 1; i < keys.length; i++) {
    const [f1, x1, y1] = keys[i];
    const [f0, x0, y0] = keys[i - 1];
    if (f <= f1) {
      const t = prog(f, f0, f1, ease.inOut);
      return { x: lerp(t, x0, x1), y: lerp(t, y0, y1) };
    }
  }
  const last = keys[keys.length - 1];
  return { x: last[1], y: last[2] };
};

export const HeroLoop: React.FC<{ variant: "desktop" | "mobile"; frame?: number }> = ({ variant, frame }) => {
  const now = useCurrentFrame();
  const f = frame ?? now;
  const L = variant === "desktop" ? DESKTOP : MOBILE;
  const u = L.ui;

  // URL intro ↔ app
  const toApp = prog(f, H.toApp, H.toApp + 36, ease.inOut);
  const reset = prog(f, H.resetFrom, H.resetFrom + 40, ease.inOut);
  const back = prog(f, H.resetFrom + 30, HERO_FRAMES - 4, ease.outQuart);
  const introVis = f < H.toApp + 40 ? 1 - toApp : back;
  const appVis = f < H.resetFrom ? toApp : 1 - reset;
  const introTyping = f < H.resetFrom;

  // app state
  const selected = prog(f, H.select, H.select + 14, ease.outExpo);
  const sheet = prog(f, H.select + 4, H.select + 40, ease.outExpo) * (1 - prog(f, H.bulkClick - 36, H.bulkClick - 8, ease.inOut));
  const bulkN = Math.round(prog(f, H.bulkFrom, BULK_END, ease.inOut) * 312);
  const bulkOn = f >= H.bulkClick;
  const bulkDone = f >= BULK_END;
  const avg = f < H.scoresFrom + 30 ? prog(f, H.scoresFrom, H.scoresFrom + 60, ease.outQuart) * AVG_BEFORE : lerp(prog(f, H.bulkFrom, BULK_END, ease.inOut), AVG_BEFORE, AVG_AFTER);

  // pointer
  const d = L.detail;
  const tile0 = tileRect(L, 0);
  const btnIntro = variant === "desktop" ? { x: 1212, y: 560 } : { x: 905, y: 746 };
  const genAll = { x: L.gridHead.x + L.gridHead.w - 110 * u, y: L.gridHead.y + 44 * u };
  const keys: [number, number, number][] = [
    [30, L.w + 60, L.h * 0.8],
    [H.submit - 6, btnIntro.x, btnIntro.y],
    [H.submit + 40, btnIntro.x + 60, btnIntro.y + 140],
    [H.select - 4, tile0.left + tile0.width * 0.55, tile0.top + tile0.height * 0.45],
    [H.gen - 4, d.x + DETAIL.genBtn.x * d.scale, d.y + DETAIL.genBtn.y * d.scale],
    [H.approve - 40, d.x + DETAIL.genBtn.x * d.scale + 40, d.y + DETAIL.genBtn.y * d.scale + 200],
    [H.approve - 4, d.x + DETAIL.approve.x * d.scale, d.y + DETAIL.approve.y * d.scale],
    [H.bulkClick - 4, genAll.x, genAll.y],
    [H.bulkClick + 60, L.w + 80, L.h * 0.85],
  ];
  const cur = pathAt(f, keys);
  const clicks = [H.submit, H.select, H.gen, H.approve, H.bulkClick];
  const lastClick = clicks.filter((k) => f >= k).pop();
  const click = lastClick !== undefined ? prog(f, lastClick, lastClick + 22) : 0;
  const curVis = prog(f, 30, 44) * (1 - prog(f, H.bulkClick + 40, H.bulkClick + 60));

  return (
    <AbsoluteFill style={{ background: c.bg, fontFamily: fonts.sans, overflow: "hidden" }}>
      <AbsoluteFill style={{ background: `radial-gradient(60% 50% at 50% 0%, ${mix(c.brand100, 70)}, transparent 70%)` }} />

      {/* app chrome */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: L.header, background: c.surface, borderBottom: `1.5px solid ${c.border}`, display: "flex", alignItems: "center", gap: 16 * u, padding: `0 ${L.pad}px` }}>
        <LogoMark size={34 * u} fill={c.brand500} />
        <span style={{ fontWeight: 600, fontSize: 22 * u, color: c.eclipse, letterSpacing: "-0.02em" }}>OneShopLab</span>
        <div style={{ display: "flex", alignItems: "center", gap: 14 * u, opacity: appVis, transform: `translateX(${(1 - appVis) * 20}px)` }}>
          <span style={{ color: c.border, fontSize: 26 * u }}>/</span>
          <span style={{ fontWeight: 500, fontSize: 21 * u, color: c.eclipse }}>{URL}</span>
          {variant === "desktop" ? <PlatformChip id="shopify" size={16} /> : null}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, opacity: appVis, fontSize: 19 * u, fontWeight: 600, color: "oklch(0.5 0.14 150)", padding: `${8 * u}px ${16 * u}px`, borderRadius: 999, background: mix(c.success, 12) }}>
          <span style={{ width: 10 * u, height: 10 * u, borderRadius: 99, background: c.success }} />
          Connected
        </div>
      </div>

      {/* URL intro — also the loop's first and last frame */}
      {introVis > 0 ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: L.header,
            bottom: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 26 * u,
            opacity: introVis,
            transform: `scale(${(0.94 + introVis * 0.06) * (variant === "desktop" ? 1.5 : 1)})`,
            filter: introVis < 1 ? `blur(${(1 - introVis) * 10}px)` : undefined,
          }}
        >
          <Eyebrow size={17 * u}>Free audit · about a minute</Eyebrow>
          <div style={{ display: "flex", gap: 12 * u }}>
            {(["shopify", "woocommerce", "wix"] as const).map((id) => (
              <PlatformChip key={id} id={id} size={18 * u} active={id === "shopify" && introTyping ? Math.min(1, Math.max(0, spr(f, H.detect, springs.snappy))) : 0} />
            ))}
          </div>
          <div
            style={{
              width: variant === "desktop" ? 820 : 900,
              height: 96 * u,
              borderRadius: 999,
              background: c.surface,
              border: `2px solid ${introTyping && f >= H.type && f < H.detect ? c.brand300 : c.fieldBorder}`,
              boxShadow: `0 24px 50px -28px ${mix(c.brand700, 40)}`,
              display: "flex",
              alignItems: "center",
              padding: `0 ${10 * u}px 0 ${34 * u}px`,
            }}
          >
            <div style={{ flex: 1, fontSize: 32 * u, color: introTyping && f >= H.type ? c.eclipse : c.muted }}>
              {introTyping ? typed(URL, f, H.type, 15) || "yourstore.com" : "yourstore.com"}
              {introTyping && f >= H.type && f < H.submit ? <span style={{ color: c.brand500, opacity: blink(f) }}>|</span> : null}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, height: 74 * u, padding: `0 ${28 * u}px`, borderRadius: 999, background: c.brand500, color: "white", fontSize: 24 * u, fontWeight: 600, transform: `scale(${f >= H.submit && f < H.submit + 8 ? 0.94 : 1})` }}>
              {introTyping && f >= H.submit && f < H.detect ? (
                <svg width={30 * u} height={30 * u} viewBox="0 0 24 24" style={{ transform: `rotate(${(f - H.submit) * 14}deg)` }}>
                  <circle cx="12" cy="12" r="9" fill="none" stroke="white" strokeWidth="2.6" strokeDasharray="36 60" strokeLinecap="round" />
                </svg>
              ) : (
                <Icon name="sparkles" size={26 * u} color="white" />
              )}
              {variant === "desktop" ? "Audit my store" : null}
              {variant === "mobile" ? <Icon name="arrowRight" size={26 * u} color="white" /> : null}
            </div>
          </div>
          <div style={{ height: 50 * u, display: "flex", alignItems: "center" }}>
            {introTyping && f >= H.detect ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: `${10 * u}px ${20 * u}px`, borderRadius: 999, background: mix(c.success, 12), color: "oklch(0.5 0.14 150)", fontWeight: 600, fontSize: 22 * u, transform: `scale(${spr(f, H.detect, springs.bouncy)})` }}>
                <Icon name="check" size={24 * u} stroke={3} />
                Shopify store detected
              </div>
            ) : (
              <span style={{ fontSize: 20 * u, color: c.muted }}>Shopify · WooCommerce · Wix — we auto-detect the platform.</span>
            )}
          </div>
        </div>
      ) : null}

      {/* the app */}
      {appVis > 0 ? (
        <div style={{ position: "absolute", inset: 0, opacity: appVis, filter: appVis < 1 ? `blur(${(1 - appVis) * 8}px)` : undefined }}>
          {/* catalog header */}
          <div style={{ position: "absolute", left: L.gridHead.x, top: L.gridHead.y, width: L.gridHead.w, height: 88 * u, display: "flex", alignItems: "center", gap: 20 * u }}>
            <ScoreRing value={avg} size={84 * u} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 34 * u, fontWeight: 700, letterSpacing: "-0.03em", color: c.eclipse, fontVariantNumeric: "tabular-nums" }}>
                {bulkDone ? "312 optimized" : bulkOn ? `${bulkN} / 312` : "Catalog"}
              </div>
              {bulkOn ? (
                <div style={{ height: 8 * u, borderRadius: 99, background: c.default, marginTop: 10 * u, overflow: "hidden", maxWidth: 360 * u }}>
                  <div style={{ height: "100%", width: `${(bulkN / 312) * 100}%`, borderRadius: 99, background: bulkDone ? c.success : `linear-gradient(90deg, ${c.brand400}, ${c.brand600})` }} />
                </div>
              ) : (
                <div style={{ fontSize: 20 * u, color: c.muted, marginTop: 2 }}>312 products · average score</div>
              )}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: `${14 * u}px ${22 * u}px`,
                borderRadius: 16,
                fontSize: 21 * u,
                fontWeight: 600,
                whiteSpace: "nowrap",
                color: bulkDone ? "white" : c.brand600,
                background: bulkDone ? c.success : bulkOn ? c.brand50 : c.surface,
                border: `2px solid ${bulkDone ? c.success : c.brand300}`,
                transform: `scale(${f >= H.bulkClick && f < H.bulkClick + 8 ? 0.94 : 1})`,
              }}
            >
              <Icon name={bulkDone ? "check" : "layers"} size={24 * u} stroke={bulkDone ? 3 : 2} />
              {bulkDone ? "Applied" : bulkOn ? "Generating…" : "Generate all"}
            </div>
          </div>

          {/* tiles */}
          {CATALOG.map((p, i) => {
            const r = tileRect(L, i);
            const s = spr(f, H.tilesFrom + i * 4, springs.snappy);
            const scoreT = prog(f, H.scoresFrom + i * H.scoreStep, H.scoresFrom + i * H.scoreStep + 20, ease.outQuart);
            const flipAt = i === 0 ? H.applied : H.bulkFrom + (i - 1) * H.bulkStep;
            const flip = prog(f, flipAt, flipAt + 22, ease.inOut);
            const dim = L.detail.sheet ? sheet * 0.6 : 0;
            return (
              <div key={i} style={{ position: "absolute", ...r, opacity: Math.min(1, s * 1.3) * (1 - dim), transform: `translateY(${(1 - s) * 60}px) scale(${0.9 + s * 0.1 + Math.sin(flip * Math.PI) * 0.05})` }}>
                <ProductTile p={p} score={scoreT > 0 ? scoreT * p.score : 0} flip={flip} imgH={L.grid.imgH} selected={i === 0 ? selected * (1 - prog(f, H.bulkClick - 20, H.bulkClick)) : 0} />
              </div>
            );
          })}

          {/* detail: side pane on desktop, bottom sheet on mobile */}
          {L.detail.sheet ? (
            sheet > 0 ? (
              <div style={{ position: "absolute", left: d.x, top: d.y + (1 - sheet) * 800, width: DETAIL.width * d.scale, height: DETAIL.height * d.scale, borderRadius: 44, background: c.surface, boxShadow: `0 -30px 80px -30px ${mix(c.brand900, 45)}`, border: `1.5px solid ${c.border}`, overflow: "hidden", opacity: Math.min(1, sheet * 2) }}>
                <div style={{ transform: `scale(${d.scale})`, transformOrigin: "top left" }}>
                  <ProductDetail f={f} k={{ gen: H.gen, title: H.title, wipe: H.wipe, approve: H.approve, applied: H.applied, scoreJump: H.scoreJump }} />
                </div>
              </div>
            ) : null
          ) : (
            <div style={{ position: "absolute", left: d.x, top: d.y, width: DETAIL.width * d.scale, height: DETAIL.height * d.scale, borderRadius: 30, background: c.surface, border: `1.5px solid ${c.border}`, boxShadow: `0 30px 70px -40px ${mix(c.brand900, 40)}`, overflow: "hidden", opacity: prog(f, H.tilesFrom, H.tilesFrom + 30) }}>
              {/* empty state until a product is picked, and again during bulk */}
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, color: c.muted, fontSize: 22, opacity: 1 - sheet }}>
                <div style={{ width: 84, height: 84, borderRadius: 24, background: c.brand50, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name={bulkOn ? "layers" : "sparkles"} size={40} color={c.brand500} />
                </div>
                <span style={{ fontWeight: 600, color: c.eclipse, fontSize: 26 }}>{bulkDone ? "Your catalog is live" : bulkOn ? "Optimizing the whole catalog" : "Pick a product"}</span>
                <span>{bulkDone ? "312 pages updated · undo anytime" : bulkOn ? "Titles · copy · tags · photos" : "The AI rewrites it in seconds"}</span>
              </div>
              {sheet > 0 ? (
                <div style={{ position: "absolute", inset: 0, opacity: sheet, transform: `translateX(${(1 - sheet) * 40}px) scale(${d.scale})`, transformOrigin: "top left" }}>
                  <ProductDetail f={f} k={{ gen: H.gen, title: H.title, wipe: H.wipe, approve: H.approve, applied: H.applied, scoreJump: H.scoreJump }} />
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {curVis > 0 ? (
        L.touch ? (
          <div style={{ position: "absolute", left: cur.x, top: cur.y, width: 64, height: 64, marginLeft: -32, marginTop: -32, borderRadius: 99, background: mix(c.eclipse, 18), border: `3px solid ${mix(c.surface, 90)}`, opacity: curVis * interpolate(click, [0, 0.2, 1], [0.9, 1, 0.9]), transform: `scale(${interpolate(click, [0, 0.3, 1], [1, 0.75, 1])})`, boxShadow: `0 0 0 ${click > 0 && click < 1 ? click * 40 : 0}px ${mix(c.brand500, 25 * (1 - click))}` }} />
        ) : (
          <Cursor x={cur.x} y={cur.y} click={click} size={40} opacity={curVis} />
        )
      ) : null}
    </AbsoluteFill>
  );
};
