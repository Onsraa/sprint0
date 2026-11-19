// Linear-style dark theme tokens (LCH hue-282 neutrals, inverted from the
// light-mode spec; accent + status colors verbatim).
import { Easing } from "remotion";

export const T = {
  // background layers (progressively lighter on dark)
  bgBase: "#08090A",
  bg: "#101012",
  bgSecondary: "#141516",
  bgTertiary: "#191A1C",
  bgElevated: "#1D1E20",

  // hairline borders
  border: "rgba(255,255,255,0.08)",
  borderStrong: "rgba(255,255,255,0.14)",

  // text
  text: "#F7F8F8",
  textSecondary: "#D0D3D8",
  textTertiary: "#8A8F98",
  textQuaternary: "#5E626A",

  // accent + status
  accent: "#5E6AD2",
  accentLight: "#6D78D5",
  green: "#43BC58",
  red: "#F34E52",
  yellow: "#F0BF00",
  orange: "#FF7235",
  cyan: "#00B8CB",
  blue: "#007EFF",

  // loop-stage colors (chapter tracker + diagrams)
  stage: {
    memory: "#00B8CB", // cyan — retrieval
    ratify: "#5E6AD2", // accent — the human gate
    verify: "#F0BF00", // yellow — checks
    compound: "#43BC58", // green — growth
  } as const,

  font: '"Inter", "Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  mono: '"Berkeley Mono", "SF Mono", Menlo, Consolas, monospace',
} as const;

// Remotion equivalents of Linear's easing curves.
export const easeOutExpo = Easing.bezier(0.19, 1, 0.22, 1);
export const easeOutQuart = Easing.bezier(0.165, 0.84, 0.44, 1);
export const easeInOutQuart = Easing.bezier(0.77, 0, 0.175, 1);
export const easeOutQuad = Easing.bezier(0.25, 0.46, 0.45, 0.94);
