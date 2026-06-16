import React from "react";
import { interpolate } from "remotion";

/**
 * Animated macOS-style pointer. `click` (0..1) drives a tap ripple + dip.
 */
export const Cursor: React.FC<{
  x: number | string;
  y: number | string;
  click?: number;
  size?: number;
}> = ({ x, y, click = 0, size = 40 }) => {
  const dip = interpolate(click, [0, 0.5, 1], [1, 0.86, 1]);
  const ripple = Math.min(click, 1);
  const rippleScale = interpolate(ripple, [0, 1], [0.2, 2.4]);
  const rippleOpacity = interpolate(ripple, [0, 0.15, 1], [0, 0.5, 0]);

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: `scale(${dip})`,
        transformOrigin: "top left",
        zIndex: 50,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 2,
          top: 2,
          width: size,
          height: size,
          borderRadius: 99,
          border: "3px solid oklch(0.560 0.215 250)",
          transform: `translate(-50%, -50%) scale(${rippleScale})`,
          opacity: rippleOpacity,
        }}
      />
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ filter: "drop-shadow(0 3px 6px rgba(0,0,0,0.35))" }}>
        <path
          d="M5 3l14 8.5-6.2 1.3L9.5 19 5 3z"
          fill="white"
          stroke="#111"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};
