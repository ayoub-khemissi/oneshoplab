import React from "react";
import { Img, staticFile } from "remotion";
import { c, fonts, mix } from "../theme";
import { ease, lerp, prog, spr, springs, typed } from "../motion";
import { Eyebrow, Icon, ScoreBadge } from "./Ui";

/** Cue frames for one generation pass on the product card. */
export type DetailCues = { gen: number; title: number; wipe: number; approve: number; applied: number; scoreJump: number };

/** Card-local geometry (the card is laid out on 1000×1340 and scaled by its container). */
export const DETAIL = { width: 1000, height: 1340, genBtn: { x: 540, y: 560 }, approve: { x: 736, y: 1272 }, badge: { x: 880, y: 62 } };

const NEW_TITLE = "Off-White Leather High-Top Sneaker — Cushioned Everyday Streetwear";
const DESC: { t: string; b?: boolean }[] = [
  { t: "Step out in " },
  { t: "premium off-white nappa leather", b: true },
  { t: " on a " },
  { t: "cushioned cream sole", b: true },
  { t: " made for all-day comfort. A clean high-top silhouette that pairs with everything, from raw denim to tailoring." },
];
const TAGS = ["high-top sneakers", "leather sneakers", "white sneakers", "streetwear", "everyday shoes"];
const SHOTS = [
  { src: "img/sneaker-studio.png", label: "1:1" },
  { src: "img/sneaker-lifestyle.png", label: "Lifestyle" },
  { src: "img/sneaker-inuse.png", label: "9:16" },
];

const Lbl: React.FC<{ children: React.ReactNode; top: number; o?: number }> = ({ children, top, o = 1 }) => (
  <div style={{ position: "absolute", left: 44, top, fontFamily: fonts.mono, fontSize: 19, letterSpacing: "0.16em", textTransform: "uppercase", color: c.muted, opacity: o }}>{children}</div>
);

/** Product card BEFORE → AFTER: generate, title types in, copy, tags, photos, approve, score jumps. */
export const ProductDetail: React.FC<{ f: number; k: DetailCues; store?: string }> = ({ f, k, store = "samsgoods.com" }) => {
  const generating = f >= k.gen;
  const skeleton = f >= k.gen && f < k.title;
  const title = typed(NEW_TITLE, f, k.title, 58);
  const descT = prog(f, k.title + 36, k.title + 110, ease.inOut);
  const wipe = prog(f, k.wipe, k.wipe + 40, ease.inOut);
  const applied = f >= k.applied;
  const score = f < k.scoreJump ? 34 : lerp(prog(f, k.scoreJump, k.scoreJump + 40, ease.outQuart), 34, 94);
  const approvePress = f >= k.approve && f < k.approve + 8 ? 0.95 : 1;
  const genClick = k.gen;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: DETAIL.width, height: DETAIL.height, fontFamily: fonts.sans }}>
    <div style={{ position: "absolute", left: 44, top: 36, right: 250, fontSize: 40, fontWeight: 600, color: c.eclipse, letterSpacing: "-0.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
      <span style={{ color: c.muted, fontWeight: 500 }}>#1 </span>
      {applied ? "Off-White Leather High-Top" : "sneaker white 01"}
    </div>
    <div style={{ position: "absolute", right: 44, top: 36, transform: `scale(${f >= k.scoreJump ? 1 + Math.sin(prog(f, k.scoreJump, k.scoreJump + 24) * Math.PI) * 0.25 : 1})` }}>
      <ScoreBadge score={score} size={30} />
    </div>

    {/* before */}
    <div style={{ position: "absolute", left: 44, top: 118 }}>
      <Eyebrow size={20}>Before</Eyebrow>
    </div>
    <div style={{ position: "absolute", left: 44, top: 162, width: 150, height: 150, borderRadius: 22, overflow: "hidden", filter: "saturate(0.8)" }}>
      <Img src={staticFile("img/sneaker-raw.png")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    </div>
    <div style={{ position: "absolute", left: 222, top: 164, right: 44 }}>
      <div style={{ fontFamily: fonts.mono, fontSize: 18, letterSpacing: "0.16em", color: c.muted }}>TITLE</div>
      <div style={{ fontSize: 32, color: c.eclipse, marginTop: 4 }}>sneaker white 01</div>
      <div style={{ fontFamily: fonts.mono, fontSize: 18, letterSpacing: "0.16em", color: c.muted, marginTop: 18 }}>DESCRIPTION</div>
      <div style={{ fontSize: 30, color: c.muted, marginTop: 4 }}>Good shoes. Very comfortable.</div>
    </div>
    <div style={{ position: "absolute", left: 44, right: 44, top: 342, height: 1.5, background: c.border }} />

    {/* after */}
    <div style={{ position: "absolute", left: 44, top: 372, display: "flex", alignItems: "center", gap: 12 }}>
      <Eyebrow size={20}>After</Eyebrow>
      <Icon name="sparkles" size={26} color={c.brand500} />
    </div>

    {!generating || skeleton ? (
      <GenerateButton f={f} at={genClick} skeleton={skeleton} />
    ) : null}

    {f >= k.title ? (
      <>
        <Lbl top={425}>Title</Lbl>
        <div style={{ position: "absolute", left: 44, right: 44, top: 454, fontSize: 44, fontWeight: 600, lineHeight: 1.2, letterSpacing: "-0.02em", color: c.eclipse }}>
          {title}
          {title.length < NEW_TITLE.length ? <span style={{ display: "inline-block", width: 4, height: 44, background: c.brand500, marginLeft: 4, verticalAlign: "middle" }} /> : null}
        </div>
        <Lbl top={588} o={prog(f, k.title + 30, k.title + 40)}>Description</Lbl>
        <div
          style={{
            position: "absolute",
            left: 44,
            right: 44,
            top: 618,
            fontSize: 30,
            lineHeight: 1.5,
            color: c.muted,
            maskImage: `linear-gradient(180deg, black ${descT * 100}%, transparent ${descT * 100 + 12}%)`,
          }}
        >
          {DESC.map((d, i) => (
            <span key={i} style={d.b ? { color: c.eclipse, fontWeight: 600 } : undefined}>
              {d.t}
            </span>
          ))}
        </div>
        <Lbl top={822} o={prog(f, k.title + 64, k.title + 74)}>Tags</Lbl>
        <div style={{ position: "absolute", left: 44, right: 44, top: 852, display: "flex", flexWrap: "wrap", gap: 12 }}>
          {TAGS.map((t, i) => {
            const s = spr(f, k.title + 70 + i * 5, springs.bouncy);
            return (
              <span key={t} style={{ transform: `scale(${s})`, opacity: Math.min(1, s), padding: "10px 20px", borderRadius: 999, background: c.brand50, color: c.brand600, fontSize: 26, fontWeight: 500, border: `1.5px solid ${c.brand100}` }}>
                {t}
              </span>
            );
          })}
        </div>
        <Lbl top={990} o={prog(f, k.wipe - 10, k.wipe)}>Images</Lbl>
        <div style={{ position: "absolute", left: 44, top: 1022, display: "flex", gap: 20 }}>
          {SHOTS.map((s, i) => {
            const pop = i === 0 ? prog(f, k.wipe - 12, k.wipe) : spr(f, k.wipe + 34 + i * 12, springs.snappy);
            return (
              <div key={s.src} style={{ position: "relative", width: 280, height: 180, borderRadius: 24, overflow: "hidden", transform: `scale(${0.85 + Math.min(1, pop) * 0.15})`, opacity: Math.min(1, pop), background: c.default }}>
                {i === 0 ? (
                  <>
                    <Img src={staticFile("img/sneaker-raw.png")} style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover" }} />
                    <Img src={staticFile(s.src)} style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover", clipPath: `polygon(0 0, ${wipe * 160}% 0, ${wipe * 160 - 60}% 100%, 0 100%)` }} />
                    {wipe > 0 && wipe < 1 ? (
                      <div style={{ position: "absolute", top: -20, bottom: -20, left: `${wipe * 160 - 38}%`, width: 30, background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.95), transparent)", transform: "skewX(-18deg)", filter: "blur(4px)" }} />
                    ) : null}
                  </>
                ) : (
                  <Img src={staticFile(s.src)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                )}
                <span style={{ position: "absolute", left: 12, bottom: 12, fontFamily: fonts.mono, fontSize: 18, fontWeight: 600, padding: "4px 10px", borderRadius: 8, background: "rgba(255,255,255,0.9)", color: c.eclipse }}>
                  {i === 0 && wipe < 0.5 ? "Original" : s.label}
                </span>
              </div>
            );
          })}
        </div>
      </>
    ) : null}

    {/* actions */}
    <div style={{ position: "absolute", left: 44, right: 44, top: 1230, display: "flex", justifyContent: "space-between", alignItems: "center", opacity: prog(f, k.wipe + 40, k.wipe + 60) }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 28, color: c.muted, padding: "20px 28px", borderRadius: 18, border: `1.5px solid ${c.border}` }}>
        <Icon name="undo" size={28} />
        Undo anytime
      </div>
      <div
        style={{
          width: 440,
          height: 84,
          borderRadius: 18,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          fontSize: 32,
          fontWeight: 600,
          color: "white",
          background: applied ? c.success : c.brand500,
          boxShadow: `0 16px 34px -14px ${applied ? mix(c.success, 80) : mix(c.brand500, 80)}`,
          transform: `scale(${approvePress})`,
        }}
      >
        <Icon name={applied ? "check" : "sparkles"} size={32} color="white" stroke={applied ? 3 : 2} />
        {applied ? `Live on ${store}` : "Approve & apply"}
      </div>
    </div>
    </div>
  );
};

const GenerateButton: React.FC<{ f: number; at: number; skeleton: boolean }> = ({ f, at, skeleton }) => {
  const pressed = f >= at && f < at + 8 ? 0.94 : 1;
  const shimmer = ((f % 50) / 50) * 140 - 20;
  if (skeleton) {
    return (
      <div style={{ position: "absolute", left: 44, right: 44, top: 430, display: "flex", flexDirection: "column", gap: 18 }}>
        {[0.9, 0.6, 1, 0.95, 0.7].map((w, i) => (
          <div key={i} style={{ height: i < 2 ? 44 : 30, width: `${w * 100}%`, borderRadius: 12, background: `linear-gradient(90deg, ${c.default} ${shimmer - 20}%, ${c.brand50} ${shimmer}%, ${c.default} ${shimmer + 20}%)` }} />
        ))}
      </div>
    );
  }
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 480, display: "flex", flexDirection: "column", alignItems: "center", gap: 26 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "26px 48px", borderRadius: 22, background: c.brand500, color: "white", fontSize: 38, fontWeight: 600, transform: `scale(${pressed})`, boxShadow: `0 20px 40px -16px ${mix(c.brand500, 80)}` }}>
        <Icon name="sparkles" size={38} color="white" />
        Generate
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        {["Claude Sonnet 5", "GPT-Image 2 · 2K"].map((m) => (
          <span key={m} style={{ fontFamily: fonts.mono, fontSize: 22, padding: "8px 16px", borderRadius: 10, background: c.default, color: c.muted }}>
            {m}
          </span>
        ))}
      </div>
    </div>
  );
};
