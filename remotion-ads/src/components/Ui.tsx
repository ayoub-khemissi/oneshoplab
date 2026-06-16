import React from "react";
import { colors, fonts, accent, accentFg } from "../theme";

export const Eyebrow: React.FC<{ children: React.ReactNode; color?: string }> = ({
  children,
  color = colors.muted,
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      fontFamily: fonts.mono,
      fontSize: 13,
      fontWeight: 500,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      color,
    }}
  >
    <span
      style={{
        width: 7,
        height: 7,
        borderRadius: 99,
        background: accent,
        boxShadow: `0 0 10px ${accent}`,
      }}
    />
    {children}
  </div>
);

export const Pill: React.FC<{
  children: React.ReactNode;
  variant?: "muted" | "accent" | "amber";
}> = ({ children, variant = "muted" }) => {
  const styles =
    variant === "accent"
      ? { color: accent, bg: "color-mix(in oklch, " + accent + " 12%, transparent)" }
      : variant === "amber"
      ? { color: colors.amber500, bg: "color-mix(in oklch, " + colors.amber500 + " 16%, transparent)" }
      : { color: colors.muted, bg: "color-mix(in oklch, " + colors.muted + " 12%, transparent)" };
  return (
    <span
      style={{
        fontFamily: fonts.mono,
        fontSize: 13,
        fontWeight: 500,
        letterSpacing: "0.04em",
        padding: "5px 11px",
        borderRadius: 8,
        color: styles.color,
        background: styles.bg,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
};

export const Button: React.FC<{
  children: React.ReactNode;
  variant?: "primary" | "ghost";
  style?: React.CSSProperties;
}> = ({ children, variant = "primary", style }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      fontFamily: fonts.sans,
      fontSize: 17,
      fontWeight: 600,
      padding: "11px 18px",
      borderRadius: 12,
      color: variant === "primary" ? accentFg : colors.foreground,
      background: variant === "primary" ? accent : "transparent",
      border: variant === "primary" ? "none" : `1.5px solid ${colors.border}`,
      boxShadow:
        variant === "primary"
          ? `0 8px 22px -8px color-mix(in oklch, ${accent} 60%, transparent)`
          : "none",
      whiteSpace: "nowrap",
      ...style,
    }}
  >
    {children}
  </div>
);

export const Sparkle: React.FC<{ size?: number; color?: string }> = ({
  size = 18,
  color = accentFg,
}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path
      d="M12 2.5l1.9 5.3c.25.7.8 1.25 1.5 1.5L20.7 11l-5.3 1.9c-.7.25-1.25.8-1.5 1.5L12 19.7l-1.9-5.3a2.4 2.4 0 0 0-1.5-1.5L3.3 11l5.3-1.9c.7-.25 1.25-.8 1.5-1.5L12 2.5z"
      fill={color}
    />
  </svg>
);

export const Card: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ children, style }) => (
  <div
    style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 18,
      ...style,
    }}
  >
    {children}
  </div>
);
