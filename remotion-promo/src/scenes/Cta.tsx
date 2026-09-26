import React from "react";
import { AbsoluteFill } from "remotion";
import { evolvePath } from "@remotion/paths";
import { c, fonts, mix } from "../theme";
import { CUE, S, ease, prog, spr, springs } from "../motion";
import { Icon, LOGO_PATHS } from "../components/Ui";
import { voLine } from "../vo";

/** End card: the mark draws itself, the promise, the URL. */
export const Cta: React.FC<{ f: number }> = ({ f }) => {
  const draw = prog(f, CUE.logoDraw, CUE.logoDraw + 55, ease.inOut);
  const fill = prog(f, CUE.logoDraw + 40, CUE.logoDraw + 70, ease.inOut);
  const markS = spr(f, CUE.logoDraw, springs.soft);
  const line = voLine("v11");
  const wordAt = (i: number) => line.at + (line.words[i]?.from ?? i * 10);
  const word = "OneShopLab";
  const url = spr(f, CUE.url, springs.bouncy);
  const shine = prog(f, CUE.url + 30, CUE.url + 75, ease.inOut);
  const glow = prog(f, S.cta.from - 10, S.cta.from + 60);

  return (
    <AbsoluteFill style={{ opacity: prog(f, S.cta.from - 16, S.cta.from + 10) }}>
      <AbsoluteFill style={{ background: `radial-gradient(55% 32% at 50% 42%, ${mix(c.brand200, 55 * glow)}, transparent 75%)` }} />

      {/* mark */}
      <svg width={260} height={260} viewBox="0 0 500 500" style={{ position: "absolute", left: 410, top: 470, transform: `scale(${0.8 + markS * 0.2})` }}>
        {LOGO_PATHS.map((d, i) => {
          const ev = evolvePath(prog(draw, i * 0.25, 1, ease.inOut), d);
          return <path key={i} d={d} fill={c.brand500} fillOpacity={fill} stroke={c.brand500} strokeWidth={6} strokeDasharray={ev.strokeDasharray} strokeDashoffset={ev.strokeDashoffset} />;
        })}
      </svg>

      {/* wordmark */}
      <div style={{ position: "absolute", top: 770, width: "100%", display: "flex", justifyContent: "center", fontFamily: fonts.sans, fontWeight: 600, fontSize: 104, letterSpacing: "-0.035em", color: c.eclipse }}>
        {word.split("").map((ch, i) => {
          const t = prog(f, wordAt(0) - 10 + i * 2.5, wordAt(0) + 18 + i * 2.5, ease.outExpo);
          return (
            <span key={i} style={{ display: "inline-block", opacity: t, transform: `translateY(${(1 - t) * 40}px)`, filter: `blur(${(1 - t) * 10}px)` }}>
              {ch}
            </span>
          );
        })}
      </div>

      {/* tagline, as on the site's hero */}
      <div style={{ position: "absolute", top: 960, width: "100%", textAlign: "center", fontFamily: fonts.sans, fontWeight: 700, fontSize: 84, letterSpacing: "-0.04em", lineHeight: 1.08 }}>
        {[
          { text: "Connect your store.", at: wordAt(1), grad: false },
          { text: "The AI does the rest.", at: wordAt(4), grad: true },
        ].map((l) => {
          const t = spr(f, l.at - 6, springs.snappy);
          return (
            <div key={l.text} style={{ overflow: "hidden", paddingBottom: 8 }}>
              <div
                style={{
                  transform: `translateY(${(1 - t) * 105}%)`,
                  color: l.grad ? "transparent" : c.eclipse,
                  backgroundImage: l.grad ? `linear-gradient(90deg, ${c.brand600}, ${c.brand400}, ${c.brand600})` : undefined,
                  backgroundSize: "200% 100%",
                  backgroundPosition: `${100 - prog(f, l.at, S.cta.to, ease.inOut) * 100}% 0`,
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

      {/* trust row */}
      <div style={{ position: "absolute", top: 1210, width: "100%", display: "flex", justifyContent: "center", gap: 34, fontFamily: fonts.sans, fontSize: 30, color: c.muted }}>
        {["Free audit", "No card required", "150 free credits"].map((t, i) => {
          const s = prog(f, CUE.tagline + 50 + i * 8, CUE.tagline + 74 + i * 8, ease.outExpo);
          return (
            <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 8, opacity: s, transform: `translateY(${(1 - s) * 20}px)` }}>
              <Icon name="check" size={30} color={c.success} stroke={3} />
              {t}
            </span>
          );
        })}
      </div>

      {/* URL button */}
      <div style={{ position: "absolute", top: 1340, width: "100%", display: "flex", justifyContent: "center" }}>
        <div
          style={{
            position: "relative",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            gap: 18,
            padding: "34px 60px",
            borderRadius: 999,
            background: c.brand500,
            color: "white",
            fontFamily: fonts.sans,
            fontWeight: 600,
            fontSize: 50,
            letterSpacing: "-0.01em",
            transform: `scale(${url})`,
            boxShadow: `0 30px 60px -20px ${mix(c.brand500, 75)}`,
          }}
        >
          oneshoplab.com
          <Icon name="arrowRight" size={48} color="white" stroke={2.4} style={{ transform: `translateX(${Math.sin(f / 8) * 4}px)` }} />
          <div style={{ position: "absolute", top: 0, bottom: 0, left: `${shine * 140 - 30}%`, width: 90, background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent)", transform: "skewX(-20deg)" }} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
