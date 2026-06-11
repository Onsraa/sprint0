/* sprint0 × Linear — UI primitives (ported verbatim from the design system's primitives.jsx).
   Monochrome, hairline, dense. Buttons are INK; orange is retired. The single Icon component lives
   in lib/icon.tsx. Every panel composes these so spacing/typography stay pixel-consistent. */
import { useState, type CSSProperties, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon, type IconName } from "../lib/icon";
import type { Availability as AvailabilityT } from "../lib/schemas";

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

export function IconButton({ name, size = 28, icon = 16, title, active = false, onClick, style = {}, children }: {
  name: IconName; size?: number; icon?: number; title?: string; active?: boolean; onClick?: () => void; style?: CSSProperties; children?: ReactNode;
}) {
  const [h, setH] = useState(false);
  return (
    <button title={title} onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ position: "relative", width: size, height: size, display: "grid", placeItems: "center", borderRadius: "var(--r-md)",
        background: active || h ? "var(--bg-hover)" : "transparent",
        color: active ? "var(--text-primary)" : "var(--text-tertiary)",
        transition: "background var(--t-quick), color var(--t-quick)", ...style }}>
      <Icon name={name} size={icon} />
      {children}
    </button>
  );
}

/* Anchored dropdown shell — the relative wrapper + click-away backdrop + the pop-in menu, factored out of
   the persona / project / bell menus (which all hand-rolled the same three divs). Controlled: the caller
   owns `open` (local state for the switchers, useApp for the bell) and renders its own `trigger`. */
export function Dropdown({ open, onClose, trigger, align = "left", top = 38, width = 256, z = 60, dropUp = false, menuStyle = {}, children }: {
  open: boolean; onClose: () => void; trigger: ReactNode;
  align?: "left" | "right"; top?: number; width?: number; z?: number; dropUp?: boolean; menuStyle?: CSSProperties; children?: ReactNode;
}) {
  return (
    <div style={{ position: "relative" }}>
      {trigger}
      {open && (
        <>
          <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: z }} />
          <div style={{ position: "absolute", ...(dropUp ? { bottom: top } : { top }), ...(align === "right" ? { right: 0 } : { left: 0 }), width, zIndex: z + 1,
            background: "var(--bg-elevated)", border: "0.5px solid var(--border-strong)", borderRadius: "var(--r-lg)",
            boxShadow: "var(--shadow-3)", padding: 6, animation: "s0-pop-in var(--t-reg) var(--ease-out) both", ...menuStyle }}>
            {children}
          </div>
        </>
      )}
    </div>
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
  setup: { label: "Architecture", color: "var(--text-primary)" },
  uiux: { label: "UI/UX", color: "var(--disc-uiux)" },
  backend: { label: "Backend", color: "var(--disc-backend)" },
  frontend: { label: "Frontend", color: "var(--disc-frontend)" },
  qa: { label: "Tester", color: "var(--disc-qa)" },
  devops: { label: "DevOps", color: "var(--disc-devops)" },
};
/* The AI returns lowercase lanes; we own the casing. discLabel = the DISC label, else the raw lane
   capitalized (an AI-discovered lane like "security" → "Security"). Never show a raw lowercase lane. */
export const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
export const discLabel = (d?: string | null) => (d ? DISC[d]?.label ?? cap(d) : "");
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

/* When a member can start NEW work — the honest capacity signal (replaces the load %).
   now=green · soon(≤3d)=blue · busy=amber. Full mode is two lines: when-free on top, then a mono
   row of active tasks (list icon) + queued days (clock icon). `compact` keeps dot + label only for
   tight rows (the relay candidate list). Ported from the v5 mockup primitives. */
const AVAIL_TONE = { now: "var(--green)", soon: "var(--blue)", busy: "var(--amber)" } as const;
function availTier(d: number): keyof typeof AVAIL_TONE { return d <= 0 ? "now" : d <= 3 ? "soon" : "busy"; }
export function Availability({ a, compact = false }: { a?: AvailabilityT | null; compact?: boolean }) {
  if (!a) return <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>—</span>;
  const tier = availTier(a.free_in_days);
  const free = tier === "now";
  const primary = free ? "Free now" : `Free in ${a.free_in_days}d`;
  const dot = <span style={{ width: 7, height: 7, borderRadius: "50%", background: AVAIL_TONE[tier], flexShrink: 0 }} />;
  const title = `Available ${free ? "now" : `in ${a.free_in_days} days`}${a.queued_days > 0 ? ` · ~${Math.round(a.queued_days)}d queued` : ""}`;

  if (compact) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }} title={title}>
        {dot}
        <span style={{ fontSize: 12, fontWeight: 500, color: free ? "var(--green)" : "var(--text-secondary)" }}>{primary}</span>
      </span>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }} title={title}>
      {dot}
      <span style={{ display: "inline-flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
        <span style={{ fontSize: 12.5, fontWeight: 500, color: free ? "var(--green)" : "var(--text-secondary)", whiteSpace: "nowrap" }}>{primary}</span>
        {(a.active_count > 0 || a.queued_days > 0) && (
          <span className="mono" style={{ display: "inline-flex", alignItems: "center", gap: 10, fontSize: 10.5, color: "var(--text-quaternary)", whiteSpace: "nowrap" }}>
            {a.active_count > 0 && (
              <span title={`${a.active_count} active ${a.active_count === 1 ? "task" : "tasks"}`} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                <Icon name="list" size={11} style={{ opacity: 0.8 }} />{a.active_count}
              </span>
            )}
            {a.queued_days > 0 && (
              <span title={`~${Math.round(a.queued_days)} days of work queued`} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                <Icon name="clock" size={11} style={{ opacity: 0.8 }} />~{Math.round(a.queued_days)}d
              </span>
            )}
          </span>
        )}
      </span>
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

/* ---- Status circle — task/issue status as a Linear-style ring/dot glyph ---- */
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

export const PRIORITY_META: Record<string, { label: string; color: string }> = {
  urgent: { label: "Urgent", color: "var(--red)" },
  high: { label: "High", color: "var(--amber)" },
  normal: { label: "Normal", color: "var(--text-quaternary)" },
  low: { label: "Low", color: "var(--text-quaternary)" },
};

// Pretty-print a machine skill/capability tag for humans: "backend:django,scheduling" → "Django · Scheduling",
// "stripe-webhooks" → "Stripe Webhooks", "db:postgresql" → "PostgreSQL". Keeps every topic (no info lost).
const TAG_CASE: Record<string, string> = {
  postgresql: "PostgreSQL", postgis: "PostGIS", jwt: "JWT", oauth: "OAuth", ci: "CI", cd: "CD", api: "API",
  ui: "UI", ux: "UX", uiux: "UI/UX", devops: "DevOps", db: "DB", css: "CSS", html: "HTML", sql: "SQL",
  aws: "AWS", gcp: "GCP", k8s: "K8s", ml: "ML", nlp: "NLP", sdk: "SDK", graphql: "GraphQL",
  websocket: "WebSocket", websockets: "WebSockets", webhooks: "Webhooks", webhook: "Webhook", saas: "SaaS", ios: "iOS",
};
const prettyToken = (t: string) => TAG_CASE[t.toLowerCase()] ?? (t ? t[0].toUpperCase() + t.slice(1) : t);
export function prettyTag(tag: string): string {
  const body = tag.includes(":") ? tag.split(":").slice(1).join(":") : tag;  // drop the area prefix (shown in context)
  const topics = body.split(/[,/]/).map((s) => s.trim()).filter(Boolean);
  return topics.map((p) => p.split(/[-_ ]+/).filter(Boolean).map(prettyToken).join(" ")).join(" · ") || tag;
}

export function CapTag({ tag }: { tag: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", height: 17, padding: "0 7px",
      borderRadius: "var(--r-xs)", background: "var(--bg-secondary)", color: "var(--text-tertiary)",
      fontSize: 10.5, fontWeight: 500, whiteSpace: "nowrap" }}>{prettyTag(tag)}</span>
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
