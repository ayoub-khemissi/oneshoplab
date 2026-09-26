import React from "react";
import { AbsoluteFill } from "remotion";
import { c, fonts } from "../theme";
import { CUE, ease, prog, spr, springs } from "../motion";
import { voLine } from "../vo";

/** Stage coordinates of the dot — the Background blooms the light world from here. */
export const BLOOM_ORIGIN = { x: 540, y: 820 };

/** Everything stops. The chaos collapses into one blue dot. "There's a better way." */
export const Pause: React.FC<{ f: number }> = ({ f }) => {
  const line = voLine("v04");
  const dotIn = spr(f, CUE.dotCollapse - 2, springs.bouncy);
  // anticipation: the dot inhales, then bursts into the bloom
  const inhale = prog(f, CUE.bloom - 34, CUE.bloom - 6, ease.inOut);
  const burst = prog(f, CUE.bloom - 6, CUE.bloom + 10, ease.inExpo);
  const pulse = 1 + Math.sin((f - CUE.dotCollapse) / 9) * 0.06 * (1 - inhale);
  const dotScale = dotIn * pulse * (1 - inhale * 0.35) * (1 + burst * 6);
  const textOut = prog(f, CUE.bloom - 40, CUE.bloom - 10, ease.inOut);

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: BLOOM_ORIGIN.x - 22,
          top: BLOOM_ORIGIN.y - 22,
          width: 44,
          height: 44,
          borderRadius: 99,
          background: c.brand500,
          boxShadow: `0 0 40px 10px ${c.brand500}, 0 0 120px 40px oklch(0.56 0.215 250 / 0.35)`,
          transform: `scale(${dotScale})`,
          opacity: (1 - burst * 0.4) * (1 - prog(f, CUE.bloom - 2, CUE.bloom + 10)),
        }}
      />
      <div
        style={{
          position: "absolute",
          top: BLOOM_ORIGIN.y + 110,
          width: "100%",
          display: "flex",
          justifyContent: "center",
          gap: 26,
          fontFamily: fonts.sans,
          fontWeight: 500,
          fontSize: 96,
          letterSpacing: "-0.035em",
          color: c.nightFg,
          opacity: 1 - textOut,
          transform: `translateY(${-textOut * 30}px)`,
          filter: `blur(${textOut * 12}px)`,
        }}
      >
        {line.words.map((w, i) => {
          const t = prog(f, line.at + w.from - 4, line.at + w.from + 22, ease.outExpo);
          return (
            <span key={i} style={{ display: "inline-block", opacity: t, filter: `blur(${(1 - t) * 16}px)`, transform: `translateY(${(1 - t) * 40}px)` }}>
              {w.w}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
