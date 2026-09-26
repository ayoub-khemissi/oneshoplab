import React from "react";
import { noise2D } from "@remotion/noise";
import { c, fonts } from "../theme";
import { ease, prog, spr, springs } from "../motion";
import { Icon, IconName } from "./Ui";

export type Notif = {
  at: number;
  app: string;
  icon: IconName;
  iconBg: string;
  title?: string;
  body: string;
};

const CARD_H = 188;
const GAP = 18;

/** Phone lock screen: date, big clock, a stack of notifications (newest on top, iOS-style). */
export const LockScreen: React.FC<{
  f: number;
  start: number;
  time: string;
  date: string;
  notifs: Notif[];
  tone: "night" | "dawn";
  listTop?: number;
}> = ({ f, start, time, date, notifs, tone, listTop = 760 }) => {
  const intro = prog(f, start, start + 50, ease.outExpo);
  const fg = "oklch(0.98 0.004 250)";

  // Phone buzz on each arrival.
  const buzz = notifs.reduce((acc, n) => {
    const d = f - n.at;
    return d >= 0 && d < 14 ? acc + noise2D("buzz", f * 0.9, n.at) * 5 * (1 - d / 14) : acc;
  }, 0);

  const arrived = notifs.filter((n) => f >= n.at);

  return (
    <div style={{ position: "absolute", inset: 0, transform: `translateX(${buzz}px)` }}>
      {/* date */}
      <div
        style={{
          position: "absolute",
          top: 250,
          width: "100%",
          textAlign: "center",
          fontFamily: fonts.sans,
          fontWeight: 500,
          fontSize: 44,
          color: fg,
          opacity: 0.85 * intro,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: 14,
          transform: `translateY(${(1 - intro) * 20}px)`,
        }}
      >
        {tone === "night" ? <Icon name="moon" size={38} color={fg} stroke={2.2} /> : null}
        {date}
      </div>
      {/* clock, digit by digit */}
      <div
        style={{
          position: "absolute",
          top: 300,
          width: "100%",
          display: "flex",
          justifyContent: "center",
          fontFamily: fonts.sans,
          fontWeight: 300,
          fontSize: 300,
          letterSpacing: "-0.05em",
          lineHeight: 1,
          color: fg,
          textShadow: tone === "dawn" ? "0 10px 60px rgba(40,50,120,0.35)" : "0 0 80px rgba(120,160,255,0.25)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {time.split("").map((ch, i) => {
          const t = prog(f, start + i * 5, start + i * 5 + 45, ease.outExpo);
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                opacity: t,
                filter: `blur(${(1 - t) * 24}px)`,
                transform: `translateY(${(1 - t) * 50}px) scale(${1.1 - t * 0.1})`,
              }}
            >
              {ch}
            </span>
          );
        })}
      </div>

      {/* notifications */}
      {arrived.map((n, idx) => {
        const order = arrived.length - 1 - idx; // 0 = newest
        const inS = spr(f, n.at + 7, springs.snappy); // let the stack make room first
        // each later arrival pushes this card one slot down
        const slotY = arrived.slice(idx + 1).reduce((y, later) => y + spr(f, later.at, springs.heavy) * (CARD_H + GAP), 0);
        const depthFade = 1;
        const depthScale = 1;
        return (
          <div
            key={n.at}
            style={{
              position: "absolute",
              left: 48,
              right: 48,
              top: listTop + slotY,
              height: CARD_H,
              transform: `translateY(${(1 - inS) * -50}px) scale(${(0.88 + inS * 0.12) * depthScale})`,
              opacity: Math.min(1, inS * 1.4) * depthFade,
              borderRadius: 48,
              background: tone === "night" ? "rgba(255,255,255,0.11)" : "rgba(255,255,255,0.42)",
              border: `1.5px solid ${tone === "night" ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.5)"}`,
              backdropFilter: "blur(30px) saturate(1.4)",
              boxShadow: "0 20px 60px -20px rgba(0,0,0,0.35)",
              display: "flex",
              alignItems: "center",
              gap: 30,
              padding: "0 36px",
              zIndex: 10 - order,
            }}
          >
            <div
              style={{
                width: 96,
                height: 96,
                borderRadius: 26,
                background: n.iconBg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Icon name={n.icon} size={52} color="white" stroke={2.2} />
            </div>
            <div style={{ flex: 1, minWidth: 0, fontFamily: fonts.sans, color: tone === "night" ? c.nightFg : c.eclipse }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontWeight: 600, fontSize: 38 }}>{n.app}</span>
                <span style={{ fontSize: 30, opacity: 0.6 }}>now</span>
              </div>
              {n.title ? <div style={{ fontWeight: 600, fontSize: 34, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.title}</div> : null}
              <div style={{ fontSize: 34, opacity: 0.88, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.body}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
