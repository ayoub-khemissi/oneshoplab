import React from "react";
import { AbsoluteFill } from "remotion";
import { c, fonts, mix } from "../theme";
import { CUE, S, ease, lerp, prog, spr, springs } from "../motion";
import { Cursor, Eyebrow, Icon, jitter } from "../components/Ui";
import { AVG_AFTER, AVG_BEFORE, CATALOG, cellRect } from "../catalog";
import { ProductTile, ScoreRing } from "./Audit";
import { DETAIL, ProductDetail } from "../components/ProductDetail";

const CARD = { left: 40, top: 170, width: DETAIL.width, height: DETAIL.height };
const GEN_BTN = { x: CARD.left + DETAIL.genBtn.x, y: CARD.top + DETAIL.genBtn.y };
const APPROVE = { x: CARD.left + DETAIL.approve.x, y: CARD.top + DETAIL.approve.y };
const BADGE = { x: CARD.left + DETAIL.badge.x, y: CARD.top + DETAIL.badge.y };


/** One product, rewritten live: title, description, tags, photos. Approve → it lands. Then the whole catalog. */
export const Generate: React.FC<{ f: number }> = ({ f }) => {
  const mIn = prog(f, S.generate.from - 20, S.generate.from + 34, ease.outExpo);
  const mOut = prog(f, CUE.bulkFrom - 44, CUE.bulkFrom - 4, ease.inOut);
  const m = mIn * (1 - mOut);
  const cell = cellRect(0);
  const rect = {
    left: lerp(m, cell.left, CARD.left),
    top: lerp(m, cell.top, CARD.top),
    width: lerp(m, cell.width, CARD.width),
    height: lerp(m, cell.height, CARD.height),
  };
  const detail = prog(m, 0.6, 1, ease.inOut);
  const exit = prog(f, S.generate.to - 36, S.generate.to + 6, ease.inExpo);

  const genClick = CUE.titleRewrite - 22;

  // pointer: in → Generate → Approve → away
  const c1 = prog(f, genClick - 40, genClick - 4, ease.outQuart);
  const c2 = prog(f, CUE.approveClick - 44, CUE.approveClick - 4, ease.inOut);
  const c3 = prog(f, CUE.approveClick + 26, CUE.approveClick + 60, ease.inOut);
  const curX = lerp(c2, lerp(c1, 1100, GEN_BTN.x + 40), APPROVE.x + 40) + c3 * 300;
  const curY = lerp(c2, lerp(c1, 1300, GEN_BTN.y + 20), APPROVE.y + 16) + c3 * 300;
  const curClick = f >= CUE.approveClick ? prog(f, CUE.approveClick, CUE.approveClick + 22) : f >= genClick ? prog(f, genClick, genClick + 22) : 0;

  // bulk
  const bulkIn = prog(f, CUE.bulkFrom - 40, CUE.bulkFrom, ease.outExpo);
  const bulkN = Math.round(prog(f, CUE.bulkFrom, CUE.bulkFrom + 100, ease.inOut) * 312);
  const bulkDone = f >= CUE.bulkFrom + 100;
  const doneS = spr(f, CUE.bulkFrom + 100, springs.bouncy);

  return (
    <AbsoluteFill style={{ opacity: 1 - exit, transform: `translateY(${-exit * 140}px) scale(${1 - exit * 0.05})`, filter: `blur(${exit * 14}px)` }}>
      {/* bulk header + grid */}
      {f >= CUE.bulkFrom - 44 ? (
        <>
          <div style={{ position: "absolute", left: 60, right: 60, top: 200, opacity: bulkIn, transform: `translateY(${(1 - bulkIn) * 40}px)`, fontFamily: fonts.sans }}>
            <Eyebrow size={22}>Bulk generation</Eyebrow>
            <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: "-0.04em", color: c.eclipse, marginTop: 14, lineHeight: 1.05, fontVariantNumeric: "tabular-nums" }}>
              {bulkDone ? "312 / 312 optimized" : `${bulkN} / 312`}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 28, marginTop: 30 }}>
              <ScoreRing value={lerp(prog(f, CUE.bulkFrom, CUE.bulkFrom + 100, ease.inOut), AVG_BEFORE, AVG_AFTER)} size={150} />
              <div style={{ flex: 1 }}>
                <div style={{ height: 14, borderRadius: 99, background: c.default, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${(bulkN / 312) * 100}%`, borderRadius: 99, background: bulkDone ? c.success : `linear-gradient(90deg, ${c.brand400}, ${c.brand600})` }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16, fontSize: 30, color: bulkDone ? "oklch(0.5 0.14 150)" : c.muted, fontWeight: bulkDone ? 600 : 400, transform: `scale(${bulkDone ? 0.9 + doneS * 0.1 : 1})`, transformOrigin: "left center" }}>
                  <Icon name={bulkDone ? "check" : "layers"} size={30} stroke={bulkDone ? 3 : 2} />
                  {bulkDone ? "Applied to your store" : "Generating titles, copy, tags, photos…"}
                </div>
              </div>
            </div>
          </div>
          {CATALOG.map((p, i) => {
            if (i === 0) return null;
            const r = cellRect(i);
            const flipAt = CUE.bulkFrom + (i - 1) * CUE.bulkStep + 8;
            const flip = prog(f, flipAt, flipAt + 22, ease.inOut);
            const s = prog(f, CUE.bulkFrom - 36 + i * 2, CUE.bulkFrom - 6 + i * 2, ease.outExpo);
            return (
              <div key={i} style={{ position: "absolute", ...r, opacity: s, transform: `scale(${0.9 + s * 0.1 + Math.sin(flip * Math.PI) * 0.06})` }}>
                <ProductTile p={p} score={p.score} flip={flip} />
              </div>
            );
          })}
        </>
      ) : null}

      {/* the hero card (grid tile #1 ↔ detail card) */}
      <div
        style={{
          position: "absolute",
          ...rect,
          borderRadius: lerp(m, 30, 44),
          background: c.surface,
          border: `1.5px solid ${f >= CUE.bulkFrom - 44 ? mix(c.success, 45, c.border) : c.border}`,
          boxShadow: `0 ${lerp(m, 24, 60)}px ${lerp(m, 50, 120)}px -40px ${mix(c.brand900, 50)}`,
          overflow: "hidden",
          zIndex: 5,
        }}
      >
        {detail < 1 ? (
          <div style={{ position: "absolute", inset: 0, opacity: 1 - detail }}>
            <ProductTile p={CATALOG[0]} score={f >= CUE.bulkFrom - 44 ? 94 : 34} flip={f >= CUE.bulkFrom - 44 ? 1 : 0} />
          </div>
        ) : null}
        {detail > 0 ? (
          <div style={{ position: "absolute", left: 0, top: 0, opacity: detail, transform: `scale(${rect.width / CARD.width})`, transformOrigin: "top left" }}>
            <ProductDetail f={f} k={{ gen: genClick, title: CUE.titleRewrite, wipe: CUE.imageWipe, approve: CUE.approveClick, applied: CUE.applied, scoreJump: CUE.scoreJump }} />
          </div>
        ) : null}
      </div>

      {/* sparkle burst on the score jump */}
      {f >= CUE.scoreJump && f < CUE.scoreJump + 50 && detail > 0.9
        ? Array.from({ length: 14 }).map((_, i) => {
            const t = prog(f, CUE.scoreJump, CUE.scoreJump + 44, ease.outExpo);
            const ang = (i / 14) * Math.PI * 2 + jitter(i, 0.3);
            const dist = 60 + t * (120 + jitter(`d${i}`, 40));
            return (
              <div key={i} style={{ position: "absolute", left: BADGE.x + Math.cos(ang) * dist, top: BADGE.y + Math.sin(ang) * dist * 0.8, transform: `translate(-50%, -50%) scale(${(1 - t) * 1.2}) rotate(${t * 90}deg)`, zIndex: 20 }}>
                <Icon name="sparkles" size={30} color={i % 2 ? c.success : c.brand400} stroke={2.4} />
              </div>
            );
          })
        : null}

      {f > genClick - 44 && f < CUE.approveClick + 62 ? <Cursor x={curX} y={curY} click={curClick} opacity={c1 * (1 - c3)} /> : null}
    </AbsoluteFill>
  );
};
