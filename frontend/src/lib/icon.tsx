/* sprint0 — single Icon component (ported verbatim from the v4 design's icons.jsx). The ONLY place
 * the app draws an icon. Lucide glyphs inlined as [tag, attrs] node arrays on a 24×24 grid; the
 * `stroke` prop keeps its 16-grid meaning and is scaled ×1.5 (default 1.5 → Lucide 2.25/24). Semantic
 * names. Brand marks (ZeroMark / FullLogo) + StatusIcon live here too. */
import { createElement, type CSSProperties } from "react";

type Node = [string, Record<string, string | number>];

const LUCIDE_ICONS = {
  // nav
  inbox: [["polyline", { points: "22 12 16 12 14 15 10 15 8 12 2 12" }], ["path", { d: "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" }]],
  board: [["rect", { width: 18, height: 18, x: 3, y: 3, rx: 2 }], ["path", { d: "M9 3v18" }], ["path", { d: "M15 3v18" }]],
  projects: [["path", { d: "m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" }], ["path", { d: "M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" }], ["path", { d: "M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" }]],
  relay: [["rect", { width: 8, height: 8, x: 3, y: 3, rx: 2 }], ["path", { d: "M7 11v4a2 2 0 0 0 2 2h4" }], ["rect", { width: 8, height: 8, x: 13, y: 13, rx: 2 }]],
  ratify: [["path", { d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" }], ["path", { d: "m9 12 2 2 4-4" }]],
  team: [["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" }], ["circle", { cx: 9, cy: 7, r: 4 }], ["path", { d: "M22 21v-2a4 4 0 0 0-3-3.87" }], ["path", { d: "M16 3.13a4 4 0 0 1 0 7.75" }]],
  merges: [["circle", { cx: 18, cy: 18, r: 3 }], ["circle", { cx: 6, cy: 6, r: 3 }], ["path", { d: "M6 21V9a9 9 0 0 0 9 9" }]],
  portfolio: [["path", { d: "M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" }], ["rect", { width: 20, height: 14, x: 2, y: 6, rx: 2 }]],
  passport: [["path", { d: "M10 2v8l3-3 3 3V2" }], ["path", { d: "M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" }]],
  qa: [["path", { d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" }], ["path", { d: "M12 8v4" }], ["path", { d: "M12 16h.01" }]],
  today: [["circle", { cx: 12, cy: 12, r: 9 }], ["circle", { cx: 12, cy: 12, r: 4.5 }], ["circle", { cx: 12, cy: 12, r: 0.6, fill: "currentColor", stroke: "none" }]],
  pool: [["rect", { width: 7, height: 7, x: 3, y: 3, rx: 1.4 }], ["rect", { width: 7, height: 7, x: 14, y: 3, rx: 1.4 }], ["rect", { width: 7, height: 7, x: 3, y: 14, rx: 1.4 }], ["rect", { width: 7, height: 7, x: 14, y: 14, rx: 1.4 }]],
  // actions / chrome
  search: [["circle", { cx: 11, cy: 11, r: 8 }], ["path", { d: "m21 21-4.3-4.3" }]],
  plus: [["path", { d: "M5 12h14" }], ["path", { d: "M12 5v14" }]],
  settings: [["path", { d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" }], ["circle", { cx: 12, cy: 12, r: 3 }]],
  bell: [["path", { d: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" }], ["path", { d: "M10.3 21a1.94 1.94 0 0 0 3.4 0" }]],
  chevronDown: [["path", { d: "m6 9 6 6 6-6" }]],
  chevronRight: [["path", { d: "m9 18 6-6-6-6" }]],
  chevronLeft: [["path", { d: "m15 18-6-6 6-6" }]],
  more: [["circle", { cx: 12, cy: 12, r: 1 }], ["circle", { cx: 19, cy: 12, r: 1 }], ["circle", { cx: 5, cy: 12, r: 1 }]],
  grip: [["circle", { cx: 9, cy: 12, r: 1 }], ["circle", { cx: 9, cy: 5, r: 1 }], ["circle", { cx: 9, cy: 19, r: 1 }], ["circle", { cx: 15, cy: 12, r: 1 }], ["circle", { cx: 15, cy: 5, r: 1 }], ["circle", { cx: 15, cy: 19, r: 1 }]],
  close: [["path", { d: "M18 6 6 18" }], ["path", { d: "m6 6 12 12" }]],
  arrowRight: [["path", { d: "M5 12h14" }], ["path", { d: "m12 5 7 7-7 7" }]],
  command: [["path", { d: "M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" }]],
  calendar: [["path", { d: "M8 2v4" }], ["path", { d: "M16 2v4" }], ["rect", { width: 18, height: 18, x: 3, y: 4, rx: 2 }], ["path", { d: "M3 10h18" }]],
  filter: [["polygon", { points: "22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" }]],
  sort: [["path", { d: "m21 16-4 4-4-4" }], ["path", { d: "M17 20V4" }], ["path", { d: "m3 8 4-4 4 4" }], ["path", { d: "M7 4v16" }]],
  list: [["path", { d: "M3 12h.01" }], ["path", { d: "M3 18h.01" }], ["path", { d: "M3 6h.01" }], ["path", { d: "M8 12h13" }], ["path", { d: "M8 18h13" }], ["path", { d: "M8 6h13" }]],
  timeline: [["path", { d: "M10 6h8" }], ["path", { d: "M12 12h6" }], ["path", { d: "M8 18h7" }], ["path", { d: "M3 3v16a2 2 0 0 0 2 2h16" }]],
  github: [["path", { d: "M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" }], ["path", { d: "M9 18c-4.51 2-5-2-7-2" }]],
  gitlab: [["path", { d: "m23.6004 9.5927-.0337-.0862L20.3.9814a.851.851 0 0 0-.3362-.405.8748.8748 0 0 0-.9997.0539.8748.8748 0 0 0-.29.4399l-2.2055 6.748H7.5375l-2.2057-6.748a.8573.8573 0 0 0-.29-.4412.8748.8748 0 0 0-.9997-.0539.8585.8585 0 0 0-.3362.405L.4332 9.5065l-.0325.0862a6.0657 6.0657 0 0 0 2.0119 7.0105l.0113.0087.03.0213 4.976 3.7264 2.462 1.8633 1.4995 1.1321a1.0085 1.0085 0 0 0 1.2197 0l1.4995-1.1321 2.462-1.8633 5.006-3.7489.0125-.01a6.0682 6.0682 0 0 0 2.0094-7.003z", fill: "currentColor", stroke: "none" }]],
  mail: [["rect", { width: 20, height: 16, x: 2, y: 4, rx: 2 }], ["path", { d: "m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" }]],
  lock: [["rect", { width: 18, height: 11, x: 3, y: 11, rx: 2, ry: 2 }], ["path", { d: "M7 11V7a5 5 0 0 1 10 0v4" }]],
  eye: [["path", { d: "M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" }], ["circle", { cx: 12, cy: 12, r: 3 }]],
  logout: [["path", { d: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" }], ["polyline", { points: "16 17 21 12 16 7" }], ["line", { x1: 21, x2: 9, y1: 12, y2: 12 }]],
  load: [["path", { d: "m12 14 4-4" }], ["path", { d: "M3.34 19a10 10 0 1 1 17.32 0" }]],
  link: [["path", { d: "M9 17H7A5 5 0 0 1 7 7h2" }], ["path", { d: "M15 7h2a5 5 0 1 1 0 10h-2" }], ["line", { x1: 8, x2: 16, y1: 12, y2: 12 }]],
  dot: [["circle", { cx: 12, cy: 12, r: 3.5, fill: "currentColor", stroke: "none" }]],
  flag: [["path", { d: "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" }], ["line", { x1: 4, x2: 4, y1: 22, y2: 15 }]],
  bolt: [["path", { d: "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" }]],
  clock: [["circle", { cx: 12, cy: 12, r: 10 }], ["polyline", { points: "12 6 12 12 16 14" }]],
  check: [["path", { d: "M20 6 9 17l-5-5" }]],
  // legacy aliases (kept so in-transition panels compile; reuse / Lucide paths)
  warn: [["path", { d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" }], ["path", { d: "M12 9v4" }], ["path", { d: "M12 17h.01" }]],
  upload: [["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }], ["polyline", { points: "17 8 12 3 7 8" }], ["line", { x1: 12, x2: 12, y1: 3, y2: 15 }]],
  doc: [["path", { d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" }], ["path", { d: "M14 2v4a2 2 0 0 0 2 2h4" }], ["path", { d: "M10 9H8" }], ["path", { d: "M16 13H8" }], ["path", { d: "M16 17H8" }]],
  codegraph: [["circle", { cx: 18, cy: 18, r: 3 }], ["circle", { cx: 6, cy: 6, r: 3 }], ["path", { d: "M6 21V9a9 9 0 0 0 9 9" }]],
  profiles: [["path", { d: "M10 2v8l3-3 3 3V2" }], ["path", { d: "M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" }]],
} satisfies Record<string, Node[]>;

export type IconName = keyof typeof LUCIDE_ICONS;

export function Icon({ name, size = 16, stroke = 1.5, style = {}, className = "" }: {
  name: IconName; size?: number; stroke?: number; style?: CSSProperties; className?: string;
}) {
  const nodes = LUCIDE_ICONS[name];
  if (!nodes) return null;
  const sw = stroke * 1.5; // old call sites pass stroke on a 16 grid; Lucide draws on 24
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw}
      strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, ...style }} className={className} aria-hidden="true">
      {(nodes as Node[]).map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}

/* Status circle — issue/task status as a Linear-style ring/dot glyph. */
const STATUS_META: Record<string, { color: string; kind: string }> = {
  planned: { color: "var(--text-quaternary)", kind: "ring" },
  in_progress: { color: "var(--amber)", kind: "half" },
  in_review: { color: "var(--blue)", kind: "dashed" },
  done: { color: "var(--green)", kind: "check" },
  blocked: { color: "var(--red)", kind: "blocked" },
};
export function StatusIcon({ status = "planned", size = 14 }: { status?: string; size?: number }) {
  const m = STATUS_META[status] || STATUS_META.planned;
  const c = m.color;
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" style={{ flexShrink: 0 }} aria-hidden="true">
      {m.kind === "ring" && <circle cx="7" cy="7" r="5" fill="none" stroke={c} strokeWidth="1.5" strokeDasharray="1.5 1.5" />}
      {m.kind === "dashed" && <circle cx="7" cy="7" r="5" fill="none" stroke={c} strokeWidth="1.5" />}
      {m.kind === "half" && (<>
        <circle cx="7" cy="7" r="5" fill="none" stroke={c} strokeWidth="1.5" />
        <path d="M7 7 L7 2.2 A4.8 4.8 0 0 1 11.8 7 Z" fill={c} />
      </>)}
      {m.kind === "check" && (<>
        <circle cx="7" cy="7" r="6" fill={c} />
        <path d="M4.4 7.2 6.2 9l3.3-3.6" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </>)}
      {m.kind === "blocked" && (<>
        <circle cx="7" cy="7" r="6" fill={c} />
        <path d="M7 4v3.4M7 9.6v.05" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      </>)}
    </svg>
  );
}

/* Brand: the paper-zero icon mark + the full wordmark (public/sprint0-wordmark.svg). */
export function ZeroMark({ size = 18 }: { size?: number }) {
  const h = size, w = (20 / 26) * size;
  return (
    <svg width={w} height={h} viewBox="0 0 20 26" fill="none" style={{ flexShrink: 0 }} aria-hidden="true">
      <path d="M18 19V3L14 4.5L15 17L8 18L10 22L18 19Z" fill="#1A1714" />
      <path d="M10 0L2 3V19L6.5 17.5L4.99999 5L11.5 3.5L10 0Z" fill="#1A1714" />
      <path d="M18 3L10 0L11.5 3.5L14 4.5L18 3Z" fill="#BDBDBD" />
      <path d="M14 4.5L11.5 3.5L8 18L14 4.5Z" fill="#1A1714" />
      <path d="M6.5 17.5L8 18L11.5 3.5L6.5 17.5Z" fill="#3A352F" />
      <path d="M2 19L10 22L8 18L6.5 17.5L2 19Z" fill="#57514A" />
    </svg>
  );
}
export function FullLogo({ size = 18, style = {} }: { size?: number; style?: CSSProperties }) {
  return <img src="/sprint0-wordmark.svg" alt="sprint0" style={{ height: size, width: "auto", display: "block", ...style }} />;
}
export function Logo({ size = 18 }: { size?: number }) {
  return <FullLogo size={size} />;
}
