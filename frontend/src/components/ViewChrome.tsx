/* sprint0 × Linear — the 44px topbar inside the floating pane (ported from Shell.jsx's ViewChrome).
   Each panel renders its own <ViewChrome breadcrumb={[...]}> as its first child, with view-specific
   actions as children; the live bell sits at the right edge. */
import { Fragment, type ReactNode } from "react";
import { Icon } from "../lib/icon";
import { BellPanel } from "../features/notify/BellPanel";
import { useWorkspace } from "../features/workspace/useWorkspace";

export function ViewChrome({ breadcrumb, title, children }: { breadcrumb?: string[]; title?: string; children?: ReactNode }) {
  const workspace = useWorkspace();
  return (
    <div style={{ height: "var(--topbar-h)", flexShrink: 0, display: "flex", alignItems: "center", gap: 8,
      padding: "0 12px 0 16px", borderBottom: "0.5px solid var(--border-subtle)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
        {breadcrumb?.map((b, i) => (
          <Fragment key={i}>
            {i > 0 && <Icon name="chevronRight" size={13} style={{ color: "var(--text-quaternary)" }} />}
            <span style={{ fontSize: 13, fontWeight: 500, color: i === breadcrumb.length - 1 ? "var(--text-primary)" : "var(--text-tertiary)" }}>{i === 0 && b === "Studio" ? workspace : b}</span>
          </Fragment>
        ))}
        {title && <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>{title}</span>}
      </div>
      <div style={{ flex: 1 }} />
      {children}
      <span style={{ width: 1, height: 18, background: "var(--border)", margin: "0 2px" }} />
      <BellPanel />
    </div>
  );
}
