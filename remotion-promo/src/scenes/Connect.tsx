import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile } from "remotion";
import { evolvePath, getLength, getPointAtLength } from "@remotion/paths";
import { c, fonts, mix } from "../theme";
import { CUE, S, blink, ease, lerp, prog, spr, springs, typed } from "../motion";
import { Cursor, Eyebrow, Icon, LogoMark, PlatformChip } from "../components/Ui";
import { voLine } from "../vo";

export const PRODUCT_IMGS = [
  "img/sneaker-raw.png",
  "img/watch.png",
  "img/headphones.png",
  "img/sunglasses.png",
  "img/demo-tshirt-1.webp",
  "img/demo-tshirt-2.webp",
  "img/sneaker-studio.png",
  "img/watch.png",
];

const LINK = "M 250 1030 C 420 850, 660 850, 830 1030";
const LINK_LEN = getLength(LINK);
const URL = "samsgoods.com";

/** The light world. Connect the store: type the URL, platform detected, catalog syncs. */
export const Connect: React.FC<{ f: number }> = ({ f }) => {
  const exit = prog(f, S.connect.to - 30, S.connect.to + 6, ease.inExpo);
  const headline = voLine("v05");

  // hero block moves up once the connection diagram arrives
  const lift = prog(f, CUE.linkFrom - 30, CUE.linkFrom + 10, ease.inOut);

  const urlText = typed(URL, f, CUE.urlTypeFrom, 15);
  const click = prog(f, CUE.urlSubmit, CUE.urlSubmit + 22, ease.outQuart);
  const pressed = f >= CUE.urlSubmit && f < CUE.urlSubmit + 8 ? 0.94 : 1;
  const loading = f >= CUE.urlSubmit && f < CUE.detect;
  const detect = spr(f, CUE.detect, springs.bouncy);

  // pointer path
  const curIn = prog(f, CUE.urlSubmit - 44, CUE.urlSubmit - 4, ease.outQuart);
  const curOut = prog(f, CUE.urlSubmit + 24, CUE.urlSubmit + 50, ease.inOut);
  const btnX = 890;
  const btnY = 760;

  const link = prog(f, CUE.linkFrom, CUE.linkFrom + 40, ease.inOut);
  const nodes = spr(f, CUE.linkFrom - 12, springs.snappy);
  const connected = spr(f, CUE.linkFrom + 38, springs.bouncy);
  const synced = Math.round(prog(f, CUE.syncCounterFrom, CUE.syncCounterFrom + 110, ease.outQuart) * 312);

  return (
    <AbsoluteFill style={{ opacity: 1 - exit, transform: `translateY(${-exit * 120}px)`, filter: `blur(${exit * 10}px)` }}>
      <div style={{ position: "absolute", inset: 0, transform: `translateY(${-lift * 90}px)` }}>
        {/* compatible with */}
        <div style={{ position: "absolute", top: 220, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 26 }}>
          <div style={{ opacity: prog(f, S.connect.from + 8, S.connect.from + 30) }}>
            <Eyebrow dot={false} size={22}>
              Compatible with
            </Eyebrow>
          </div>
          <div style={{ display: "flex", gap: 16 }}>
            {(["shopify", "woocommerce", "wix"] as const).map((id, i) => {
              const s = spr(f, S.connect.from + 10 + i * 5, springs.snappy);
              return (
                <div key={id} style={{ opacity: s, transform: `translateY(${(1 - s) * 40}px)` }}>
                  <PlatformChip id={id} size={30} active={id === "shopify" ? Math.min(1, Math.max(0, detect)) : 0} />
                </div>
              );
            })}
          </div>
        </div>

        {/* headline, word by word on the voice */}
        <div style={{ position: "absolute", top: 400, width: "100%", textAlign: "center", fontFamily: fonts.sans, fontWeight: 700, fontSize: 110, letterSpacing: "-0.045em", color: c.eclipse, lineHeight: 1.05 }}>
          {["Connect", "your", "store."].map((w, i) => {
            const at = headline.at + (headline.words[[0, 3, 7][i]]?.from ?? i * 12) - 6;
            const t = spr(f, Math.min(at, S.connect.from + 18 + i * 8), springs.snappy);
            return (
              <span key={w} style={{ display: "inline-block", overflow: "hidden", verticalAlign: "bottom", paddingBottom: 10, marginRight: i < 2 ? 26 : 0 }}>
                <span style={{ display: "inline-block", transform: `translateY(${(1 - t) * 110}%)` }}>{w}</span>
              </span>
            );
          })}
          <div style={{ fontSize: 40, fontWeight: 400, letterSpacing: "-0.01em", color: c.muted, marginTop: 20, opacity: prog(f, S.connect.from + 40, S.connect.from + 70) }}>
            Free audit in about a minute.
          </div>
        </div>

        {/* URL field */}
        <div
          style={{
            position: "absolute",
            left: 70,
            right: 70,
            top: 690,
            height: 140,
            borderRadius: 999,
            background: c.surface,
            border: `2px solid ${f >= CUE.urlTypeFrom && f < CUE.detect ? c.brand300 : c.fieldBorder}`,
            boxShadow: `0 30px 60px -30px ${mix(c.brand700, 40)}, 0 0 0 ${f >= CUE.urlTypeFrom && f < CUE.detect ? 8 : 0}px ${mix(c.brand500, 12)}`,
            display: "flex",
            alignItems: "center",
            padding: "0 16px 0 48px",
            transform: `scale(${0.9 + spr(f, S.connect.from + 26, springs.snappy) * 0.1})`,
            opacity: prog(f, S.connect.from + 24, S.connect.from + 44),
          }}
        >
          <div style={{ flex: 1, fontFamily: fonts.sans, fontSize: 46, color: urlText ? c.eclipse : c.muted }}>
            {urlText || "yourstore.com"}
            {f >= CUE.urlTypeFrom && f < CUE.urlSubmit ? <span style={{ color: c.brand500, opacity: blink(f) }}>|</span> : null}
          </div>
          <div
            style={{
              height: 108,
              width: 170,
              borderRadius: 999,
              background: c.brand500,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              transform: `scale(${pressed})`,
              boxShadow: `0 14px 30px -10px ${mix(c.brand500, 70)}`,
            }}
          >
            {loading ? (
              <svg width={48} height={48} viewBox="0 0 24 24" style={{ transform: `rotate(${(f - CUE.urlSubmit) * 14}deg)` }}>
                <circle cx="12" cy="12" r="9" fill="none" stroke="white" strokeWidth="2.6" strokeDasharray="36 60" strokeLinecap="round" />
              </svg>
            ) : (
              <>
                <Icon name="sparkles" size={40} color="white" />
                <Icon name="arrowRight" size={40} color="white" />
              </>
            )}
          </div>
        </div>

        {/* detected */}
        <div
          style={{
            position: "absolute",
            top: 860,
            width: "100%",
            display: "flex",
            justifyContent: "center",
            opacity: Math.min(1, detect),
            transform: `translateY(${(1 - detect) * -30}px) scale(${0.8 + detect * 0.2})`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 28px", borderRadius: 999, background: mix(c.success, 12), color: "oklch(0.5 0.14 150)", fontFamily: fonts.sans, fontWeight: 600, fontSize: 32 }}>
            <Icon name="check" size={32} stroke={3} />
            Shopify store detected
          </div>
        </div>
      </div>

      {/* connection diagram */}
      {f >= CUE.linkFrom - 14 ? (
        <div style={{ position: "absolute", inset: 0, opacity: nodes }}>
          <svg width={1080} height={1920} style={{ position: "absolute", inset: 0 }}>
            <path d={LINK} fill="none" stroke={mix(c.brand300, 50)} strokeWidth={6} strokeLinecap="round" strokeDasharray={evolvePath(link, LINK).strokeDasharray} strokeDashoffset={evolvePath(link, LINK).strokeDashoffset} />
            {link >= 1 ? <path d={LINK} fill="none" stroke={c.brand500} strokeWidth={6} strokeLinecap="round" strokeDasharray="4 22" strokeDashoffset={-f * 1.6} /> : null}
          </svg>
          <Node x={250} y={1030} s={nodes} label={URL} sub="Shopify">
            <Img src={staticFile("img/shopify.svg")} style={{ width: 96 }} />
          </Node>
          <Node x={830} y={1030} s={spr(f, CUE.linkFrom - 4, springs.snappy)} label="OneShopLab" sub="Connected" brand>
            <LogoMark size={110} fill="white" />
          </Node>
          <div style={{ position: "absolute", left: 540, top: 895, transform: `translate(-50%, -50%) scale(${connected})`, display: "flex", alignItems: "center", gap: 12, padding: "12px 24px", borderRadius: 999, background: c.surface, border: `1.5px solid ${c.border}`, boxShadow: `0 10px 30px -12px ${mix(c.eclipse, 25)}`, fontFamily: fonts.sans, fontWeight: 600, fontSize: 28, color: c.eclipse }}>
            <span style={{ width: 14, height: 14, borderRadius: 99, background: c.success, boxShadow: `0 0 0 ${6 + Math.sin(f / 6) * 3}px ${mix(c.success, 20)}` }} />
            Connected
          </div>

          {/* products streaming along the link */}
          {PRODUCT_IMGS.map((src, i) => {
            const t = prog(f, CUE.syncCounterFrom + i * 11, CUE.syncCounterFrom + i * 11 + 46, ease.inOut);
            if (t <= 0 || t >= 1) return null;
            const p = getPointAtLength(LINK, t * LINK_LEN);
            const sc = Math.sin(t * Math.PI);
            return (
              <div key={i} style={{ position: "absolute", left: p.x, top: p.y, width: 84, height: 84, borderRadius: 22, overflow: "hidden", transform: `translate(-50%, -50%) scale(${0.4 + sc * 0.7})`, boxShadow: `0 10px 24px -8px ${mix(c.brand800, 45)}`, border: `3px solid ${c.surface}`, background: c.surface }}>
                <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
            );
          })}

          {/* sync counter */}
          <div
            style={{
              position: "absolute",
              left: 90,
              right: 90,
              top: 1235,
              padding: "36px 44px",
              borderRadius: 36,
              background: c.surface,
              border: `1.5px solid ${c.border}`,
              boxShadow: `0 40px 80px -40px ${mix(c.brand800, 35)}`,
              transform: `translateY(${(1 - spr(f, CUE.syncCounterFrom - 10, springs.snappy)) * 80}px)`,
              opacity: prog(f, CUE.syncCounterFrom - 10, CUE.syncCounterFrom + 10),
              fontFamily: fonts.sans,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Eyebrow size={22}>Catalog sync</Eyebrow>
              <Icon name="sync" size={34} color={c.brand500} style={{ transform: `rotate(${synced < 312 ? f * 6 : 0}deg)` }} />
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginTop: 14 }}>
              <span style={{ fontSize: 96, fontWeight: 700, letterSpacing: "-0.04em", color: c.eclipse, fontVariantNumeric: "tabular-nums" }}>{synced}</span>
              <span style={{ fontSize: 36, color: c.muted }}>products synced</span>
            </div>
            <div style={{ height: 10, borderRadius: 99, background: c.default, marginTop: 18, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(synced / 312) * 100}%`, background: `linear-gradient(90deg, ${c.brand400}, ${c.brand600})`, borderRadius: 99 }} />
            </div>
            <div style={{ fontSize: 28, color: c.muted, marginTop: 18 }}>Titles · descriptions · tags · images</div>
          </div>
        </div>
      ) : null}

      {f < CUE.urlSubmit + 50 ? (
        <Cursor
          x={lerp(curIn, 1150, btnX) + curOut * 260}
          y={lerp(curIn, 1500, btnY) + curOut * 400}
          click={f >= CUE.urlSubmit ? click : 0}
          opacity={curIn * (1 - curOut)}
        />
      ) : null}
    </AbsoluteFill>
  );
};

const Node: React.FC<{ x: number; y: number; s: number; label: string; sub: string; brand?: boolean; children: React.ReactNode }> = ({ x, y, s, label, sub, brand, children }) => (
  <div style={{ position: "absolute", left: x, top: y, transform: `translate(-50%, -50%) scale(${interpolate(s, [0, 1], [0.5, 1])})`, opacity: Math.min(1, s * 1.5), display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
    <div
      style={{
        width: 190,
        height: 190,
        borderRadius: 50,
        background: brand ? `linear-gradient(145deg, ${c.brand400}, ${c.brand600})` : c.surface,
        border: brand ? "none" : `1.5px solid ${c.border}`,
        boxShadow: brand ? `0 30px 60px -20px ${mix(c.brand500, 70)}` : `0 30px 60px -30px ${mix(c.eclipse, 30)}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </div>
    <div style={{ textAlign: "center", fontFamily: fonts.sans }}>
      <div style={{ fontWeight: 600, fontSize: 32, color: c.eclipse }}>{label}</div>
      <div style={{ fontFamily: fonts.mono, fontSize: 20, letterSpacing: "0.14em", textTransform: "uppercase", color: c.muted, marginTop: 4 }}>{sub}</div>
    </div>
  </div>
);
