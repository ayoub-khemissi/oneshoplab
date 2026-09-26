import React from "react";
import { c, fonts } from "../theme";
import { CUE, S, ease, prog } from "../motion";
import { VO } from "../vo";

// Lines already shown as on-screen type are not captioned twice.
const SKIP = new Set(["v04", "v11"]);

/** Word-synced captions (timings from whisper) — most feeds autoplay muted. */
export const Captions: React.FC<{ f: number; top?: number }> = ({ f, top = 1580 }) => {
  const line = VO.find((l, i) => {
    const next = VO[i + 1];
    const end = Math.min(l.at + l.durationInFrames + 24, next ? next.at - 2 : Infinity);
    return f >= l.at - 2 && f < end;
  });
  if (!line || SKIP.has(line.id)) return null;
  const dark = f < CUE.bloom || (f >= S.morning.from && f < S.morning.to);
  const next = VO[VO.indexOf(line) + 1];
  const end = Math.min(line.at + line.durationInFrames + 24, next ? next.at - 2 : Infinity);
  const out = prog(f, end - 10, end, ease.inOut);
  return (
    <div
      style={{
        position: "absolute",
        left: 70,
        right: 70,
        top,
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        columnGap: 14,
        rowGap: 4,
        fontFamily: fonts.sans,
        fontWeight: 600,
        fontSize: 50,
        lineHeight: 1.2,
        letterSpacing: "-0.015em",
        opacity: 1 - out,
        textShadow: dark ? "0 2px 18px rgba(0,0,0,0.55)" : "0 2px 16px rgba(255,255,255,0.9)",
      }}
    >
      {line.words.map((w, i) => {
        const at = line.at + w.from;
        const t = prog(f, at - 3, at + 9, ease.outExpo);
        const speaking = f >= at && f < line.at + w.to + 4;
        const base = dark ? "oklch(0.98 0.004 250)" : c.eclipse;
        const hi = dark ? c.brand300 : c.brand500;
        return (
          <span key={i} style={{ display: "inline-block", opacity: 0.15 + t * 0.85, transform: `translateY(${(1 - t) * 14}px)`, color: speaking ? hi : base }}>
            {w.w}
          </span>
        );
      })}
    </div>
  );
};
