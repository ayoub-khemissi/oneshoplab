import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";

/**
 * Shared design box for the browser-mockup scenes. Identical dims across scenes
 * keep the frame the same size/position on cut. Sized to the tallest scene
 * (the optimize reveal) so nothing clips in 1:1.
 */
export const DESIGN = { width: 1000, height: 1180 } as const;

/**
 * Renders children at a fixed design size and scales them down (never up past 1)
 * to fit the current composition, centered. Lets the same browser-mockup scene
 * fill a 1:1 square and a 9:16 vertical without clipping. Using identical
 * design dimensions across scenes keeps the browser frame the same size on cut.
 */
export const Stage: React.FC<{
  designWidth: number;
  designHeight: number;
  margin?: number;
  children: React.ReactNode;
  background?: string;
}> = ({ designWidth, designHeight, margin = 0.94, children, background }) => {
  const { width, height } = useVideoConfig();
  const scale = Math.min(
    (width * margin) / designWidth,
    (height * margin) / designHeight,
  );
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", background }}>
      <div
        style={{
          width: designWidth,
          height: designHeight,
          transform: `scale(${scale})`,
          transformOrigin: "center",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};
