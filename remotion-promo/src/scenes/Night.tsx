import React from "react";
import { AbsoluteFill } from "remotion";
import { c } from "../theme";
import { CUE, S, ease, prog } from "../motion";
import { LockScreen } from "../components/LockScreen";

/** 01:47. Sam's phone lights up: Mom worries, the store stays silent. */
export const Night: React.FC<{ f: number }> = ({ f }) => {
  const push = 1 + prog(f, 0, S.night.to, ease.inOut) * 0.05;
  // Exit: dive toward the store notification.
  const out = prog(f, S.night.to - 40, S.night.to + 20, ease.inExpo);
  return (
    <AbsoluteFill
      style={{
        transform: `scale(${push + out * 1.1})`,
        transformOrigin: "50% 48%",
        filter: `blur(${out * 26}px)`,
        opacity: 1 - out,
      }}
    >
      <LockScreen
        f={f}
        start={4}
        tone="night"
        time="1:47"
        date="Tuesday, March 10"
        notifs={[
          { at: CUE.notifMom, app: "Mom", icon: "heart", iconBg: `linear-gradient(135deg, oklch(0.72 0.17 15), oklch(0.62 0.2 0))`, body: "You're still up? Go to sleep." },
          { at: CUE.notifStore, app: "Sam's Goods", icon: "bag", iconBg: `linear-gradient(135deg, ${c.brand400}, ${c.brand600})`, title: "Daily summary", body: "0 orders today · 312 products live" },
        ]}
      />
    </AbsoluteFill>
  );
};
