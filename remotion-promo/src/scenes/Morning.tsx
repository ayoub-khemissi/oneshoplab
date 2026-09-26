import React from "react";
import { AbsoluteFill } from "remotion";
import { c } from "../theme";
import { CUE, S, ease, prog } from "../motion";
import { LockScreen, Notif } from "../components/LockScreen";

const store = { app: "Sam's Goods", icon: "bag" as const, iconBg: `linear-gradient(135deg, ${c.brand400}, ${c.brand600})` };
const ORDERS: Notif[] = [
  { ...store, at: CUE.ordersFrom, title: "New order #1048 · $129", body: "Off-White Leather High-Top Sneaker" },
  { ...store, at: CUE.ordersFrom + CUE.orderStep, title: "New order #1049 · $249", body: "Skeleton Automatic Watch" },
  { ...store, at: CUE.ordersFrom + CUE.orderStep * 2, title: "New order #1050 · $89", body: "Tortoiseshell Sunglasses" },
  { ...store, at: CUE.ordersFrom + CUE.orderStep * 3, title: "New order #1051 · $129", body: "Off-White Leather High-Top Sneaker" },
  {
    at: CUE.ordersFrom + CUE.orderStep * 4 + 14,
    app: "Mom",
    icon: "heart",
    iconBg: `linear-gradient(135deg, oklch(0.72 0.17 15), oklch(0.62 0.2 0))`,
    body: "You slept! Proud of you.",
  },
];

/** 7:30. Same phone, new day: orders, and Mom again. */
export const Morning: React.FC<{ f: number }> = ({ f }) => {
  const enter = prog(f, S.morning.from - 10, S.morning.from + 36, ease.outExpo);
  const exit = prog(f, S.morning.to - 26, S.morning.to + 14, ease.inExpo);
  return (
    <AbsoluteFill
      style={{
        opacity: enter * (1 - exit),
        transform: `scale(${1.06 - enter * 0.06 + exit * 0.12})`,
        filter: `blur(${(1 - enter) * 16 + exit * 20}px)`,
      }}
    >
      <LockScreen f={f} start={S.morning.from} tone="dawn" time="7:30" date="Wednesday, March 11" notifs={ORDERS} listTop={700} />
    </AbsoluteFill>
  );
};
