import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile } from "remotion";
import { c, fonts, mix, scoreColor } from "../theme";
import { CUE, S, ease, prog, spr, springs } from "../motion";
import { Eyebrow, Icon, ScoreBadge } from "../components/Ui";
import { AVG_BEFORE, CATALOG, GRID, Product, cellRect } from "../catalog";

/** Score ring like the audit report's average. */
export const ScoreRing: React.FC<{ value: number; size?: number }> = ({ value, size = 150 }) => {
  const r = size / 2 - 10;
  const len = 2 * Math.PI * r;
  const col = scoreColor(value);
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={c.default} strokeWidth={12} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={12} strokeLinecap="round" strokeDasharray={`${(value / 100) * len} ${len}`} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: fonts.sans }}>
        <span style={{ fontSize: size * 0.34, fontWeight: 700, letterSpacing: "-0.04em", color: c.eclipse, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{Math.round(value)}</span>
        <span style={{ fontFamily: fonts.mono, fontSize: size * 0.11, color: c.muted }}>/100</span>
      </div>
    </div>
  );
};

/** One product tile. `flip` 0→1 turns it to its optimised back face. */
export const ProductTile: React.FC<{ p: Product; score: number; flip?: number; scan?: number; imgH?: number; selected?: number }> = ({ p, score, flip = 0, scan = 0, imgH = 160, selected = 0 }) => {
  const face = (after: boolean): React.CSSProperties => ({
    position: "absolute",
    inset: 0,
    borderRadius: 30,
    background: c.surface,
    border: `1.5px solid ${after ? mix(c.success, 45, c.border) : c.border}`,
    boxShadow: `0 24px 50px -30px ${mix(c.brand900, 40)}${scan > 0 ? `, 0 0 0 ${4 * scan}px ${mix(c.brand400, 40 * scan)}` : ""}${selected > 0 ? `, 0 0 0 ${4 * selected}px ${mix(c.brand500, 80 * selected)}` : ""}`,
    padding: 14,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    backfaceVisibility: "hidden",
    transform: after ? "rotateY(180deg)" : undefined,
    overflow: "hidden",
  });
  const img = (src: string) => (
    <div style={{ height: imgH, borderRadius: 20, overflow: "hidden", background: c.default }}>
      <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: "flip" in p ? "scaleX(-1)" : undefined }} />
    </div>
  );
  return (
    <div style={{ position: "absolute", inset: 0, transformStyle: "preserve-3d", transform: `perspective(1400px) rotateY(${flip * 180}deg)` }}>
      <div style={face(false)}>
        {img(p.img)}
        <div style={{ fontFamily: fonts.sans, fontSize: 25, fontWeight: 500, color: c.eclipse, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
        <div>{score > 0 ? <ScoreBadge score={score} size={22} /> : <span style={{ display: "inline-block", height: 34, width: 110, borderRadius: 99, background: c.default }} />}</div>
      </div>
      <div style={face(true)}>
        {img("after" in p ? p.after : p.img)}
        <div style={{ fontFamily: fonts.sans, fontSize: 25, fontWeight: 600, color: c.eclipse, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.better}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ScoreBadge score={p.next} size={22} />
          <Icon name="check" size={28} color={c.success} stroke={3} />
        </div>
      </div>
    </div>
  );
};

const ISSUES = [
  { label: "Titles too short", col: c.danger },
  { label: "Thin descriptions", col: c.danger },
  { label: "Weak photos", col: c.warning },
  { label: "No tags", col: c.warning },
];

/** 312 products scored in about a minute: the tiles land, a scan passes, red scores drop in. */
export const Audit: React.FC<{ f: number }> = ({ f }) => {
  const from = S.audit.from;
  const handoff = prog(f, S.generate.from - 30, S.generate.from, ease.inOut); // others step back while card #1 expands
  const scanY = interpolate(f, [CUE.scoresFrom - 20, CUE.scoresFrom + 110], [GRID.y0 - 60, GRID.y0 + 3 * (GRID.h + GRID.gapY)], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease.inOut });
  const scanOn = f > CUE.scoresFrom - 20 && f < CUE.scoresFrom + 115;
  const avg = prog(f, CUE.scoresFrom + 40, CUE.scoresFrom + 120, ease.outQuart) * AVG_BEFORE;
  const headIn = spr(f, from - 4, springs.snappy);

  return (
    <AbsoluteFill style={{ opacity: 1 - handoff * 0.0 }}>
      {/* header */}
      <div style={{ position: "absolute", left: 60, right: 60, top: 200, opacity: headIn * (1 - handoff), transform: `translateY(${(1 - headIn) * 40 - handoff * 40}px)`, fontFamily: fonts.sans }}>
        <Eyebrow size={22}>Audit · samsgoods.com</Eyebrow>
        <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: "-0.04em", color: c.eclipse, marginTop: 14, lineHeight: 1.05 }}>312 products scored</div>
        <div style={{ display: "flex", alignItems: "center", gap: 28, marginTop: 30 }}>
          <ScoreRing value={avg} size={150} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {ISSUES.map((it, i) => {
              const s = spr(f, CUE.scoresFrom + 60 + i * 7, springs.bouncy);
              return (
                <span key={it.label} style={{ transform: `scale(${s})`, opacity: Math.min(1, s), display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 18px", borderRadius: 999, background: mix(it.col, 12), color: it.col, fontSize: 26, fontWeight: 600 }}>
                  <Icon name="alert" size={24} stroke={2.4} />
                  {it.label}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* grid */}
      {CATALOG.map((p, i) => {
        if (i === 0 && f >= S.generate.from - 20) return null; // card #1 is now the Generate hero
        const rect = cellRect(i);
        const s = spr(f, from + 4 + i * 4, springs.snappy);
        const scoreT = prog(f, CUE.scoresFrom + i * CUE.scoreStep, CUE.scoresFrom + i * CUE.scoreStep + 22, ease.outQuart);
        const scanHit = scanOn ? Math.max(0, 1 - Math.abs(scanY - (rect.top + rect.height / 2)) / 140) : 0;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              ...rect,
              opacity: Math.min(1, s * 1.3) * (1 - handoff),
              transform: `translateY(${(1 - s) * 160}px) scale(${(0.85 + s * 0.15) * (1 - handoff * 0.08)})`,
              filter: handoff > 0 ? `blur(${handoff * 8}px)` : undefined,
            }}
          >
            <ProductTile p={p} score={scoreT > 0 ? scoreT * p.score : 0} scan={scanHit} />
          </div>
        );
      })}

      {/* scan line */}
      {scanOn ? (
        <div style={{ position: "absolute", left: 30, right: 30, top: scanY, height: 4, borderRadius: 99, background: `linear-gradient(90deg, transparent, ${c.brand400}, ${c.brand500}, ${c.brand400}, transparent)`, boxShadow: `0 0 40px 12px ${mix(c.brand400, 45)}` }} />
      ) : null}
    </AbsoluteFill>
  );
};
