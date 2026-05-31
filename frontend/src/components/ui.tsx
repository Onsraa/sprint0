/* sprint0 × Linear — UI primitives (ported verbatim from the design system's primitives.jsx).
   Monochrome, hairline, dense. Buttons are INK; orange is retired. The single Icon component lives
   in lib/icon.tsx. Every panel composes these so spacing/typography stay pixel-consistent. */
import { useState, type CSSProperties, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon, type IconName } from "../lib/icon";

type Variant = "primary" | "secondary" | "ghost" | "accent";
type Size = "sm" | "md" | "lg";

export function Button({
  variant = "secondary", size = "md", icon, iconRight, children, style = {}, ...rest
}: {
  variant?: Variant; size?: Size; icon?: IconName; iconRight?: IconName; children?: ReactNode; style?: CSSProperties;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const sizes = { sm: { h: 26, px: 9, fs: 12 }, md: { h: 30, px: 12, fs: 13 }, lg: { h: 36, px: 16, fs: 14 } }[size];
  const base: CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
    height: sizes.h, padding: `0 ${sizes.px}px`, fontSize: sizes.fs, fontWeight: 500,
    borderRadius: "var(--r-md)", whiteSpace: "nowrap",
    transition: "background var(--t-quick), box-shadow var(--t-quick), color var(--t-quick), transform var(--t-quick)",
    letterSpacing: "-0.1px",
  };
  const variants: Record<Variant, CSSProperties> = {
    primary: { background: "var(--ink-fill)", color: "#fff" },
    secondary: { background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "0.5px solid var(--border-strong)", boxShadow: "var(--shadow-1)" },
    ghost: { background: "transparent", color: "var(--text-tertiary)" },
    accent: { background: "var(--accent)", color: "#fff" },
  };
  const [h, setH] = useState(false), [p, setP] = useState(false);
  const hov: Record<Variant, CSSProperties> = {
    primary: { background: "var(--ink-fill-hover)" },
    secondary: { background: "var(--bg-hover)" },
    ghost: { background: "var(--bg-hover)", color: "var(--text-secondary)" },
    accent: { background: "var(--accent-deep)" },
  };
  return (
    <button
      onMouseEnter={() => setH(true)} onMouseLeave={() => { setH(false); setP(false); }}
      onMouseDown={() => setP(true)} onMouseUp={() => setP(false)}
      style={{ ...base, ...variants[variant], ...(h ? hov[variant] : {}), ...(p ? { transform: "translateY(0.5px)" } : {}), ...style }}
      {...rest}>
      {icon && <Icon name={icon} size={14} />}
      {children}
      {iconRight && <Icon name={iconRight} size={14} />}
    </button>
  );
}

export function IconButton({ name, size = 28, icon = 16, title, active = false, onClick, style = {} }: {
  name: IconName; size?: number; icon?: number; title?: string; active?: boolean; onClick?: () => void; style?: CSSProperties;
}) {
  const [h, setH] = useState(false);
  return (
    <button title={title} onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ width: size, height: size, display: "grid", placeItems: "center", borderRadius: "var(--r-md)",
        background: active || h ? "var(--bg-hover)" : "transparent",
        color: active ? "var(--text-primary)" : "var(--text-tertiary)",
        transition: "background var(--t-quick), color var(--t-quick)", ...style }}>
      <Icon name={name} size={icon} />
    </button>
  );
}

export function Tab({ active, children, onClick, count }: {
  active?: boolean; children?: ReactNode; onClick?: () => void; count?: number | null;
}) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 10px",
        borderRadius: "var(--r-pill)", fontSize: 12, fontWeight: 500, letterSpacing: "-0.1px",
        background: active ? "var(--bg-elevated)" : h ? "var(--bg-hover)" : "transparent",
        color: active ? "var(--text-primary)" : "var(--text-tertiary)",
        border: active ? "0.5px solid var(--border)" : "0.5px solid transparent",
        boxShadow: active ? "var(--shadow-1)" : "none", transition: "all var(--t-quick)" }}>
      {children}
      {count != null && <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>{count}</span>}
    </button>
  );
}

export function Kbd({ children }: { children?: ReactNode }) {
  return (
    <kbd style={{ display: "inline-grid", placeItems: "center", minWidth: 18, height: 18, padding: "0 4px",
      fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 400, color: "var(--text-tertiary)",
      background: "var(--bg-elevated)", border: "0.5px solid var(--border-strong)", borderRadius: "var(--r-xs)",
      lineHeight: 1 }}>{children}</kbd>
  );
}

const AV_TINTS = ["#E7E2DA", "#E3E4DE", "#E6E0E6", "#DFE4E6", "#EAE2DC"];
export function Avatar({ name = "?", size = 20, tone, ring = false }: {
  name?: string; size?: number; tone?: "ink" | "accent"; ring?: boolean;
}) {
  const initials = name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  const idx = Math.abs([...name].reduce((a, c) => a + c.charCodeAt(0), 0)) % AV_TINTS.length;
  const bg = tone === "ink" ? "var(--ink-fill)" : tone === "accent" ? "var(--accent)" : AV_TINTS[idx];
  const fg = tone === "ink" || tone === "accent" ? "#fff" : "var(--text-secondary)";
  return (
    <span style={{ width: size, height: size, borderRadius: "50%", background: bg, color: fg,
      display: "grid", placeItems: "center", fontSize: size * 0.42, fontWeight: 600, flexShrink: 0, letterSpacing: "-0.2px",
      boxShadow: ring ? "0 0 0 2px var(--bg-elevated), 0 0 0 3px var(--border)" : "none" }}>
      {initials || "?"}
    </span>
  );
}
export function EmptyAvatar({ size = 20 }: { size?: number }) {
  return <span style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, border: "1.2px dashed var(--border-strong)" }} />;
}

export type BadgeTone = "neutral" | "outline" | "ink" | "accent" | "green" | "amber" | "blue" | "red";
export function Badge({ children, tone = "neutral", style = {}, mono = false }: {
  children?: ReactNode; tone?: BadgeTone; style?: CSSProperties; mono?: boolean;
}) {
  const tones: Record<BadgeTone, { bg: string; fg: string; bd: string }> = {
    neutral: { bg: "var(--bg-secondary)", fg: "var(--text-tertiary)", bd: "transparent" },
    outline: { bg: "transparent", fg: "var(--text-tertiary)", bd: "var(--border-strong)" },
    ink: { bg: "var(--ink-fill)", fg: "#fff", bd: "transparent" },
    accent: { bg: "var(--accent-soft)", fg: "var(--accent-deep)", bd: "transparent" },
    green: { bg: "rgba(47,138,78,0.12)", fg: "var(--green)", bd: "transparent" },
    amber: { bg: "rgba(199,120,0,0.13)", fg: "var(--amber)", bd: "transparent" },
    blue: { bg: "rgba(42,111,219,0.12)", fg: "var(--blue)", bd: "transparent" },
    red: { bg: "rgba(212,58,58,0.12)", fg: "var(--red)", bd: "transparent" },
  };
  const t = tones[tone];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 18, padding: "0 7px",
      borderRadius: "var(--r-sm)", fontSize: 11, fontWeight: 500, letterSpacing: "-0.1px",
      background: t.bg, color: t.fg, border: `0.5px solid ${t.bd}`,
      fontFamily: mono ? "var(--font-mono)" : "inherit", whiteSpace: "nowrap", ...style }}>
      {children}
    </span>
  );
}

export const DISC: Record<string, { label: string; color: string }> = {
  uiux: { label: "UI/UX", color: "var(--disc-uiux)" },
  backend: { label: "Backend", color: "var(--disc-backend)" },
  frontend: { label: "Frontend", color: "var(--disc-frontend)" },
  qa: { label: "QA", color: "var(--disc-qa)" },
  devops: { label: "DevOps", color: "var(--disc-devops)" },
};
export function DiscDot({ d, size = 7 }: { d?: string | null; size?: number }) {
  return <span style={{ width: size, height: size, borderRadius: 2, background: (d && DISC[d]?.color) || "var(--text-quaternary)", flexShrink: 0, display: "inline-block" }} />;
}

export const TRUST_COLOR: Record<string, string> = { high: "var(--green)", medium: "var(--blue)", low: "var(--text-quaternary)" };
export function TrustDot({ level = "medium" }: { level?: string }) {
  return <span style={{ width: 7, height: 7, borderRadius: "50%", background: TRUST_COLOR[level] ?? "var(--text-quaternary)", flexShrink: 0 }} />;
}
export function LoadMeter({ value = 0, width = 44 }: { value?: number; width?: number }) {
  const over = value >= 100;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width, height: 4, borderRadius: 2, background: "var(--bg-tertiary)", overflow: "hidden", display: "inline-block" }}>
        <span style={{ display: "block", height: "100%", width: `${Math.min(value, 100)}%`, background: over ? "var(--amber)" : "var(--text-tertiary)", borderRadius: 2 }} />
      </span>
      <span className="mono" style={{ fontSize: 11, color: over ? "var(--amber)" : "var(--text-quaternary)" }}>{value}%</span>
    </span>
  );
}

export function SectionHeader({ open = true, onToggle, glyph, label, count, right }: {
  open?: boolean; onToggle?: () => void; glyph?: ReactNode; label?: ReactNode; count?: number | null; right?: ReactNode;
}) {
  const [h, setH] = useState(false);
  return (
    <div onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: "flex", alignItems: "center", gap: 7, height: 32, padding: "0 8px", cursor: "pointer", userSelect: "none" }}
      onClick={onToggle}>
      <span style={{ color: "var(--text-quaternary)", display: "grid", placeItems: "center",
        transform: open ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform var(--t-quick)" }}>
        <Icon name="chevronDown" size={14} />
      </span>
      {glyph}
      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>{label}</span>
      {count != null && <span className="mono" style={{ fontSize: 12, color: "var(--text-quaternary)" }}>{count}</span>}
      <div style={{ flex: 1 }} />
      <span style={{ opacity: h ? 1 : 0, transition: "opacity var(--t-quick)" }}>{right}</span>
    </div>
  );
}

export function Tooltip({ label, kbd, children }: { label: ReactNode; kbd?: string[]; children?: ReactNode }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex" }} onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <span style={{ position: "absolute", bottom: "calc(100% + 7px)", left: "50%", transform: "translateX(-50%)",
          display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 8px", whiteSpace: "nowrap",
          background: "var(--text-primary)", color: "#fff", borderRadius: "var(--r-sm)", fontSize: 12, fontWeight: 500,
          boxShadow: "var(--shadow-2)", zIndex: 90, animation: "s0-fade-in var(--t-quick) both", pointerEvents: "none" }}>
          {label}
          {kbd && <span style={{ display: "inline-flex", gap: 3 }}>{kbd.map((k, i) => <span key={i} style={{ fontFamily: "var(--font-mono)", fontSize: 11, opacity: 0.7 }}>{k}</span>)}</span>}
        </span>
      )}
    </span>
  );
}
