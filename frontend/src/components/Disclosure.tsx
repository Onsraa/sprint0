import { useState, type ReactNode } from "react";

/* Concise-primary + deferred detail. Keeps cards short: the summary line is always
   visible, the detail expands inline on click. Native-feeling, no scroll. */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginTop: 6 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          fontSize: 11,
          fontWeight: 700,
          color: "var(--ink-mute)",
          background: "none",
          padding: 0,
          cursor: "pointer",
        }}
      >
        <span style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 120ms" }}>▸</span>
        {summary}
      </button>
      {open && <div style={{ marginTop: 6 }}>{children}</div>}
    </div>
  );
}
