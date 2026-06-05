/* sprint0 × Linear — app shell (ported from the v4 design Shell.jsx). 244px role-gated nav rail with
 * the persona switcher, then the content as a floating white pane. Wired to the useApp() adapter; auth
 * gates the Landing (logged out) vs the shell (logged in). The wizard + ⌘K palette mount here. */
import { useState, useMemo } from "react";
import { Outlet } from "@tanstack/react-router";
import { useApp } from "./useApp";
import { useNavShortcuts } from "../features/nav/useNavShortcuts";
import { useMe } from "../features/auth/useAuth";
import { useUI } from "../lib/store";
import { useRoleGate } from "../features/nav/nav";
import { Icon, FullLogo, ZeroMark } from "../lib/icon";
import { Avatar, Kbd, IconButton, Dropdown } from "../components/ui";
import { useHoverState } from "../lib/hooks";
import { Landing } from "../views/Landing";
import { Wizard } from "../wizard/Wizard";
import { FeatureWizard } from "../wizard/FeatureWizard";
import { CommandPalette } from "../features/palette/CommandPalette";
import { useNotificationsWS } from "../features/notify/useNotifications";
import { useHealth } from "../features/health/useHealth";
import { useWorkspace } from "../features/workspace/useWorkspace";
import { live, api } from "../lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

/* The demo roster shown in the persona switcher (the 5 real seeded accounts). */
export const DEMO_PERSONAS = [
  { username: "Onsraa", name: "Teddy", role: "manager", discipline: null },
  { username: "sprint0-se", name: "Jean Gabriel", role: "developer", discipline: "backend" },
  { username: "sprint0-sse", name: "Tony Stark", role: "developer", discipline: "devops" },
  { username: "sprint0-fe", name: "Sam Dupont", role: "developer", discipline: "frontend" },
  { username: "sprint0-qa", name: "Pascal Alice", role: "qa", discipline: "qa" },
];

/* nav items carry a `roles` allowlist + capability flags — per-role chrome. */
/* v4 two-plane: the Overview group reads first (Today · Relays) → Work → Explore → System.
   Code Graph + Merges + standalone Profiles are CUT (routes stay, unlinked); Projects + Team
   are now universal; capability Profiles fold into Team's "Capabilities" tab. Tester replaces
   QA gate. Devs/managers reach Contract from the Today "Start here" card, not a standing item. */
const NAV = [
  { section: "Overview", items: [
    { id: "relays", label: "Relays", icon: "pool", kbd: ["G", "L"], roles: ["manager", "developer", "qa"] },
  ] },
  { section: "Work", items: [
    { id: "mywork", label: "My Work", icon: "board", kbd: ["G", "W"], roles: ["manager", "developer", "qa"] },
    { id: "qagate", label: "Tester", icon: "qa", kbd: ["G", "Q"], roles: ["qa"] },
  ] },
  { section: "Explore", items: [
    { id: "projects", label: "Projects", icon: "projects", kbd: ["G", "P"], roles: ["manager", "developer", "qa"] },
    { id: "team", label: "Team", icon: "team", roles: ["manager", "developer", "qa"] },
    { id: "portfolio", label: "Decisions", icon: "portfolio", roles: ["manager", "developer", "qa"] },
    { id: "passport", label: "Passport", icon: "passport", roles: ["developer", "qa"] },
  ] },
  { section: "System", items: [
    { id: "settings", label: "Settings", icon: "settings", roles: ["manager"] },
  ] },
] as const;

/** A single nav leaf, flattened out of NAV's grouped/role-gated structure (the collapsed rail drops the
    section headers, so it maps leaves directly — NAV's heterogeneous `as const` tuple needs this shape). */
type NavLeaf = { id: string; label: string; icon: string; kbd?: readonly string[]; roles: readonly string[] };

export function AppShellNew() {
  const { member, authLoading, role } = useMe();
  const wizardOpen = useUI((s) => s.wizardOpen);
  const wizardKind = useUI((s) => s.wizardKind);
  const togglePalette = useUI((s) => s.togglePalette);
  useNotificationsWS(member?.username);
  useRoleGate(member ? role : null);

  if (authLoading) return <SessionLoading />;
  if (!member) return <Landing />;
  // The wizard is its own full-screen route (no sidebar), matching the v4/v5 design.
  if (wizardOpen) return <Wizard kind={wizardKind} />;

  return (
    <div style={{ display: "flex", height: "100vh", background: "var(--bg-app)" }}>
      <Sidebar onPalette={togglePalette} />
      <div style={{ flex: 1, minWidth: 0, padding: "8px 8px 8px 0" }}>
        <div className="pane">
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "auto" }}>
            <Outlet />
          </div>
        </div>
      </div>
      <CommandPalette />
      <FeatureWizard />
    </div>
  );
}

function SessionLoading() {
  return (
    <div style={{ height: "100vh", display: "grid", placeItems: "center", background: "var(--bg-app)" }}>
      <div className="mono" style={{ fontSize: 12, color: "var(--text-tertiary)" }}>restoring your session…</div>
    </div>
  );
}

function Sidebar({ onPalette }: { onPalette: () => void }) {
  const collapsed = useUI((s) => s.navCollapsed);   // store, not local state → survives shell remount + reload
  const toggleNav = useUI((s) => s.toggleNav);
  const { setView, role } = useApp();
  // "g then key" nav shortcuts (collision-free vs ⌘) — only the views this role actually has are reachable.
  // gatecontract has no standing nav item but is a valid G,C / deep-link destination for every role.
  const allowed = useMemo(() => new Set([...NAV.flatMap((grp) => grp.items as readonly NavLeaf[]).filter((it) => it.roles.includes(role)).map((it) => it.id), "gatecontract"]), [role]);
  useNavShortcuts(setView, (v) => allowed.has(v));
  return (
    <aside style={{ width: collapsed ? 54 : "var(--nav-w)", flexShrink: 0, height: "100vh", transition: "width var(--t-reg) var(--ease-out)" }}>
      {collapsed
        ? <CollapsedRail onExpand={toggleNav} onPalette={onPalette} />
        : <ExpandedNav onCollapse={toggleNav} onPalette={onPalette} />}
    </aside>
  );
}

/* Full-width nav column. The collapse chevron is the shared IconButton. */
function ExpandedNav({ onCollapse, onPalette }: { onCollapse: () => void; onPalette: () => void }) {
  const { view, setView, role, chrome } = useApp();
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: "10px 8px 8px", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
        <div style={{ flex: 1, minWidth: 0 }}><Workspace /></div>
        <IconButton name="chevronLeft" title="Collapse sidebar" onClick={onCollapse} />
      </div>
      <SearchTrigger onClick={onPalette} />
      {chrome.canDispatch && (
        <button onClick={() => setView("wizard")} title="New from brief" style={{ display: "flex", alignItems: "center", gap: 8, height: 32, margin: "2px 0", padding: "0 10px", borderRadius: "var(--r-md)", background: "var(--ink-fill)", color: "#fff", fontSize: 13, fontWeight: 500 }}>
          <Icon name="plus" size={15} /> New from brief
        </button>
      )}
      <nav style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: 4 }}>
        {NAV.map((grp, gi) => {
          const items = grp.items.filter((it) => (it.roles as readonly string[]).includes(role));
          if (!items.length) return null;
          return (
            <div key={gi} style={{ marginTop: grp.section ? 12 : 0 }}>
              {grp.section && (
                <div style={{ height: 24, display: "flex", alignItems: "center", padding: "0 10px", fontSize: 11, fontWeight: 500, color: "var(--text-quaternary)", letterSpacing: "0.02em" }}>{grp.section}</div>
              )}
              {items.map((it) => <NavItem key={it.label} item={it} active={view === it.id} onClick={() => setView(it.id)} />)}
            </div>
          );
        })}
      </nav>
      <div style={{ flex: 1 }} />
      <SidebarFooter />
    </div>
  );
}

/* Collapsed 54px icon rail — the zero mark expands, the nav folds to centered IconButtons, the expand
   chevron sits at the bottom above the avatar (mirrors the design's Shell.jsx collapsed layer). */
function CollapsedRail({ onExpand, onPalette }: { onExpand: () => void; onPalette: () => void }) {
  const { view, setView, role, chrome, me } = useApp();
  const items = NAV.flatMap((g) => g.items as readonly NavLeaf[]).filter((it) => it.roles.includes(role));
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", padding: "10px 0 8px", gap: 3 }}>
      <button onClick={onExpand} title="Expand sidebar" style={{ width: 36, height: 36, display: "grid", placeItems: "center", borderRadius: "var(--r-md)" }}>
        <ZeroMark size={18} />
      </button>
      <IconButton name="search" title="Search · ⌘K" onClick={onPalette} />
      {chrome.canDispatch && (
        <button onClick={() => setView("wizard")} title="New from brief" style={{ width: 30, height: 30, display: "grid", placeItems: "center", borderRadius: "var(--r-md)", background: "var(--ink-fill)", color: "#fff", margin: "2px 0" }}>
          <Icon name="plus" size={16} />
        </button>
      )}
      <div style={{ height: 6 }} />
      {items.map((it) => <IconButton key={it.label} name={it.icon as never} title={it.label} active={view === it.id} onClick={() => setView(it.id)} />)}
      <div style={{ flex: 1 }} />
      <IconButton name="chevronRight" title="Expand sidebar" onClick={onExpand} />
      <button title={me.name ?? undefined} style={{ width: 34, height: 34, display: "grid", placeItems: "center" }}>
        <Avatar name={me.name ?? "?"} size={26} tone={role === "manager" ? "ink" : undefined} />
      </button>
    </div>
  );
}

function Workspace() {
  const { me, switchPersona } = useApp();
  const workspace = useWorkspace();
  const [open, setOpen] = useState(false);
  const [h, hover] = useHoverState();
  return (
    <Dropdown open={open} onClose={() => setOpen(false)} align="left" top={40} width={256} z={60}
      trigger={
        <button onClick={() => setOpen((o) => !o)} {...hover}
          style={{ display: "flex", alignItems: "center", gap: 9, height: 36, padding: "0 8px", borderRadius: "var(--r-md)", width: "100%", background: open || h ? "var(--bg-hover)" : "transparent", transition: "background var(--t-quick)" }}>
          <FullLogo size={17} />
          <span style={{ fontSize: 12, color: "var(--text-quaternary)", fontWeight: 500, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>· {workspace}</span>
          <div style={{ flex: 1 }} />
          <Icon name="chevronDown" size={14} style={{ color: "var(--text-quaternary)" }} />
        </button>
      }>
      <div className="mono" style={{ fontSize: 10, color: "var(--text-quaternary)", padding: "6px 8px 4px", letterSpacing: "0.05em", textTransform: "uppercase" }}>Switch persona</div>
      {DEMO_PERSONAS.map((p) => (
        <button key={p.username} onClick={() => { switchPersona(p.username); setOpen(false); }}
          style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "8px", borderRadius: "var(--r-md)", background: p.username === me.username ? "var(--bg-hover)" : "transparent", textAlign: "left" }}>
          <Avatar name={p.name} size={26} tone={p.role === "manager" ? "ink" : undefined} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</div>
            <div className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>{p.role}{p.discipline ? " · " + p.discipline : ""}</div>
          </div>
          {p.username === me.username && <Icon name="check" size={15} style={{ color: "var(--text-primary)" }} />}
        </button>
      ))}
    </Dropdown>
  );
}

function SearchTrigger({ onClick }: { onClick: () => void }) {
  const [h, hover] = useHoverState();
  return (
    <button onClick={onClick} {...hover}
      style={{ display: "flex", alignItems: "center", gap: 8, height: 30, padding: "0 8px", borderRadius: "var(--r-md)", background: h ? "var(--bg-hover)" : "transparent", color: "var(--text-tertiary)", transition: "background var(--t-quick)" }}>
      <Icon name="search" size={15} />
      <span style={{ fontSize: 13, fontWeight: 500 }}>Search</span>
      <div style={{ flex: 1 }} />
      <span style={{ display: "inline-flex", gap: 2 }}><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
    </button>
  );
}

function NavItem({ item, active, onClick }: { item: { id: string; label: string; icon: string; kbd?: readonly string[] }; active: boolean; onClick: () => void }) {
  const [h, hover] = useHoverState();
  return (
    <button onClick={onClick} {...hover}
      style={{ position: "relative", display: "flex", alignItems: "center", gap: 9, width: "100%", height: 28, padding: "0 10px", borderRadius: "var(--r-md)", textAlign: "left",
        background: active ? "var(--bg-active)" : h ? "var(--bg-hover)" : "transparent", color: active ? "var(--text-primary)" : "var(--text-secondary)", transition: "background var(--t-quick), color var(--t-quick)" }}>
      <Icon name={item.icon as never} size={16} style={{ color: active ? "var(--text-secondary)" : "var(--text-tertiary)" }} />
      <span style={{ fontSize: 13, fontWeight: 500, letterSpacing: "-0.1px" }}>{item.label}</span>
      <div style={{ flex: 1 }} />
      {h && item.kbd && <span style={{ display: "inline-flex", gap: 2 }}>{item.kbd.map((k, i) => <Kbd key={i}>{k}</Kbd>)}</span>}
    </button>
  );
}

function SidebarFooter() {
  const { me, role, switchPersona } = useApp();
  // REAL liveness — green when the gateway reaches Mongo/MCP, red when it can't, amber while checking.
  const { data: health } = useHealth();
  const online = health?.ok;
  const dot = online === true ? "var(--green)" : online === false ? "var(--red)" : "var(--amber)";
  const label = online === true ? "MCP · online" : online === false ? "MCP · offline" : "MCP · …";
  // REAL mode — LIVE on a non-demo deploy, or once this tab unlocked via ?unlock=; else DEMO.
  const isLive = health?.demo_mode === false || live.active();
  const modeDot = isLive ? "var(--green)" : "var(--amber)";
  const modeLabel = isLive ? "LIVE" : "DEMO";
  const [open, setOpen] = useState(false);
  const [h, hover] = useHoverState();
  // DEMO-only: wipe this session's test mutations (handoffs/ratifies) back to the clean canned board.
  const qc = useQueryClient();
  const [resetting, setResetting] = useState(false);
  const resetDemo = () => {
    if (!window.confirm("Reset the demo to its clean mid-flight state? This clears test handoffs and ratifications.")) return;
    setResetting(true);
    api.demoReset().then(() => { qc.invalidateQueries(); toast.success("Demo reset to the clean board."); })
      .catch(() => toast.error("Reset failed")).finally(() => setResetting(false));
  };
  const [rh, resetHover] = useHoverState();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, height: 28, padding: "0 10px" }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot }} />
        <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)", fontWeight: 500 }}>{label}</span>
        <div style={{ flex: 1 }} />
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: modeDot }} />
        <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)", fontWeight: 500 }}>{modeLabel}</span>
      </div>
      {!isLive && (
        <button onClick={resetDemo} disabled={resetting} {...resetHover} title="Reset the demo to its clean state"
          style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", height: 24, padding: "0 10px", borderRadius: "var(--r-md)",
            background: rh ? "var(--bg-hover)" : "transparent", color: "var(--text-quaternary)", fontSize: 11, fontWeight: 500, transition: "background var(--t-quick)" }}>
          <Icon name="relay" size={12} /> {resetting ? "Resetting…" : "Reset demo"}
        </button>
      )}
      <Dropdown open={open} onClose={() => setOpen(false)} align="left" top={44} width={236} z={70} dropUp
        trigger={
          <button onClick={() => setOpen((o) => !o)} {...hover} title="Account · switch persona"
            style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", height: 36, padding: "0 8px", borderRadius: "var(--r-md)", background: open || h ? "var(--bg-hover)" : "transparent", transition: "background var(--t-quick)" }}>
            <Avatar name={me.name ?? "?"} size={22} tone={role === "manager" ? "ink" : undefined} />
            <div style={{ textAlign: "left", lineHeight: 1.2, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{me.name}</div>
              <div className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>{role}{me.discipline ? " · " + me.discipline : ""}</div>
            </div>
            <div style={{ flex: 1 }} />
            <Icon name="more" size={16} style={{ color: "var(--text-quaternary)" }} />
          </button>
        }>
        <div className="mono" style={{ fontSize: 10, color: "var(--text-quaternary)", padding: "6px 8px 4px", letterSpacing: "0.05em", textTransform: "uppercase" }}>Switch persona</div>
        {DEMO_PERSONAS.map((p) => (
          <button key={p.username} onClick={() => { switchPersona(p.username); setOpen(false); }}
            style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "8px", borderRadius: "var(--r-md)", background: p.username === me.username ? "var(--bg-hover)" : "transparent", textAlign: "left" }}>
            <Avatar name={p.name} size={26} tone={p.role === "manager" ? "ink" : undefined} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</div>
              <div className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>{p.role}{p.discipline ? " · " + p.discipline : ""}</div>
            </div>
            {p.username === me.username && <Icon name="check" size={15} style={{ color: "var(--text-primary)" }} />}
          </button>
        ))}
      </Dropdown>
    </div>
  );
}
