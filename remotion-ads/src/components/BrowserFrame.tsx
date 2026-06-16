import React from "react";
import { colors, fonts } from "../theme";

/**
 * A clean macOS-style browser window used to frame the "screencast" of the app.
 */
export const BrowserFrame: React.FC<{
  children: React.ReactNode;
  url?: string;
  style?: React.CSSProperties;
}> = ({ children, url = "www.oneshoplab.com/dashboard", style }) => {
  return (
    <div
      style={{
        width: "100%",
        borderRadius: 20,
        overflow: "hidden",
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        boxShadow:
          "0 40px 90px -30px rgba(15,23,42,0.45), 0 12px 30px -12px rgba(15,23,42,0.25)",
        ...style,
      }}
    >
      {/* chrome bar */}
      <div
        style={{
          height: 52,
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "0 18px",
          background: colors.bg,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <div style={{ display: "flex", gap: 9 }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <span
              key={c}
              style={{ width: 13, height: 13, borderRadius: 99, background: c }}
            />
          ))}
        </div>
        <div
          style={{
            flex: 1,
            height: 32,
            margin: "0 8px",
            borderRadius: 10,
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "0 14px",
            fontFamily: fonts.mono,
            fontSize: 14,
            color: colors.muted,
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <rect x="5" y="11" width="14" height="9" rx="2" stroke={colors.muted} strokeWidth="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke={colors.muted} strokeWidth="2" />
          </svg>
          {url}
        </div>
      </div>
      <div style={{ position: "relative" }}>{children}</div>
    </div>
  );
};
