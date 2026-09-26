import { Easing, interpolate, spring } from "remotion";
import timeline from "./timeline.json";

export const TL = timeline;
export const FPS = timeline.fps;
export const S = timeline.scenes;
export const CUE = timeline.cues;

export const ease = {
  outExpo: Easing.bezier(0.16, 1, 0.3, 1),
  outQuart: Easing.bezier(0.25, 1, 0.5, 1),
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
  inExpo: Easing.bezier(0.7, 0, 0.84, 0),
  outBack: Easing.bezier(0.34, 1.56, 0.64, 1),
};

/** 0→1 between frames a and b, clamped, eased. */
export const prog = (f: number, a: number, b: number, e: (t: number) => number = ease.outExpo) =>
  interpolate(f, [a, b], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: e });

export const lerp = (t: number, a: number, b: number) => a + (b - a) * t;

type SpringCfg = { damping?: number; stiffness?: number; mass?: number };
export const springs = {
  snappy: { damping: 14, stiffness: 180, mass: 0.7 },
  soft: { damping: 20, stiffness: 90, mass: 1 },
  bouncy: { damping: 9, stiffness: 160, mass: 0.6 },
  heavy: { damping: 26, stiffness: 120, mass: 1.4 },
} satisfies Record<string, SpringCfg>;

export const spr = (f: number, at: number, config: SpringCfg = springs.snappy) =>
  spring({ frame: f - at, fps: FPS, config });

/** Typewriter: characters revealed at `cps` chars per second from frame `at`. */
export const typed = (text: string, f: number, at: number, cps = 18) =>
  text.slice(0, Math.max(0, Math.floor(((f - at) / FPS) * cps)));

export const blink = (f: number, period = 32) => (Math.floor(f / (period / 2)) % 2 === 0 ? 1 : 0);

/** A scene's local window, with some bleed so transitions can overlap. */
export const inScene = (f: number, name: keyof typeof S, before = 0, after = 0) =>
  f >= S[name].from - before && f < S[name].to + after;
