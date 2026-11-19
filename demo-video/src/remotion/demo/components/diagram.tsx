import React from "react";
import { T } from "../theme";

// Small shared diagram primitives for the architecture scenes.

export const Card: React.FC<{
  x: number;
  y: number; // top-left
  w: number;
  enter: number; // 0..1
  color?: string;
  title: string;
  sub?: string;
  glow?: number; // 0..1 pulse glow
  children?: React.ReactNode;
  center?: boolean;
}> = ({ x, y, w, enter, color = T.borderStrong, title, sub, glow = 0, children, center }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      width: w,
      padding: "18px 22px",
      borderRadius: 12,
      border: `1px solid ${color}`,
      background: T.bg,
      opacity: enter,
      transform: `translateY(${(1 - enter) * 24}px) scale(${1 + glow * 0.04})`,
      boxShadow: glow > 0 ? `0 0 ${glow * 40}px ${color}55` : "none",
      fontFamily: T.font,
      textAlign: center ? "center" : "left",
    }}
  >
    <div style={{ fontSize: 25, fontWeight: 600, color: T.text, letterSpacing: -0.3 }}>{title}</div>
    {sub && <div style={{ fontSize: 16.5, color: T.textTertiary, marginTop: 3 }}>{sub}</div>}
    {children}
  </div>
);

export const Chip: React.FC<{
  label: string;
  color?: string;
  enter?: number;
  style?: React.CSSProperties;
}> = ({ label, color = T.textTertiary, enter = 1, style }) => (
  <span
    style={{
      display: "inline-block",
      padding: "4px 13px",
      borderRadius: 9999,
      border: `0.5px solid ${color}`,
      background: `${color}1A`,
      fontSize: 15.5,
      fontWeight: 500,
      color: T.textSecondary,
      marginRight: 8,
      marginTop: 9,
      opacity: enter,
      transform: `translateY(${(1 - enter) * 8}px)`,
      whiteSpace: "nowrap",
      ...style,
    }}
  >
    {label}
  </span>
);

// A dot traveling along a straight line, looping.
export const FlowDot: React.FC<{
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  t: number; // 0..1 position
  color: string;
  r?: number;
  opacity?: number;
}> = ({ x1, y1, x2, y2, t, color, r = 6, opacity = 1 }) => (
  <circle
    cx={x1 + (x2 - x1) * t}
    cy={y1 + (y2 - y1) * t}
    r={r}
    fill={color}
    opacity={opacity}
    style={{ filter: `drop-shadow(0 0 6px ${color})` }}
  />
);
