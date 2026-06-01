/* sprint0 — Today: the directed-workflow spine (§34). The home EVERY persona lands on: one ranked,
   role-filtered list of next-actions across all relays (ranking in features/today/rank.ts). The #1
   item is the self-explaining "Start here" card; the rest are compact "Next" rows. Reason chips make
   the rank read as earned. Ported 1:1 from the v6 design (Today.jsx); the mock todayFor()/reasonChips
   helpers are replaced by the useApp().next selector, and each row deep-links via the store primitives. */
import { useState } from "react";
import { useApp } from "../app/useApp";
import { useUI } from "../lib/store";
import { ViewChrome } from "../components/ViewChrome";
import { Button, Tab, DiscDot, DISC, Avatar } from "../components/ui";
import { Icon, ZeroMark, type IconName } from "../lib/icon";
import type { NextItem, NextTarget, NextChip } from "../features/today/rank";

const ACTION_ICON: Record<string, IconName> = { relay: "ratify", qagate: "qa", scope: "board", reschedule: "clock", relays: "pool" };
const CHIP_LABEL: Record<string, string> = { next: "next", delta: "delta", consent: "consent", ready: "ready", gap: "orphan gap" };

const chipMeta = (c: NextChip): { label: string; spark: boolean } =>
  c.kind === "baton" ? { label: "baton", spark: true }
    : c.kind === "blocks" ? { label: `blocks ${c.n}`, spark: false }
    : { label: CHIP_LABEL[c.kind] ?? c.kind, spark: false };

const boltWhy = (it: NextItem): string => {
  if (it.chips.some((c) => c.kind === "baton")) return "waits on your call";
  const b = it.chips.find((c) => c.kind === "blocks");
  if (b) return `unblocks ${b.n} downstream`;
  if (it.chips.some((c) => c.kind === "ready")) return "ready to dispatch";
  if (it.chips.some((c) => c.kind === "consent")) return "needs your consent";
  if (it.chips.some((c) => c.kind === "gap")) return "no owner — routes to you";
  return "next in your planned order";
};

function Chips({ chips, size = "md" }: { chips: NextChip[]; size?: "sm" | "md" }) {
  const h = size === "sm" ? 18 : 20;
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      {chips.map((c, i) => {
        const m = chipMeta(c);
        return (
          <span key={i} className="mono" style={{ display: "inline-flex", alignItems: "center", gap: 4, height: h, padding: "0 8px",
            borderRadius: "var(--r-pill)", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.01em",
            background: m.spark ? "var(--ink-fill)" : "var(--bg-secondary)", color: m.spark ? "#fff" : "var(--text-tertiary)",
            border: m.spark ? "none" : "0.5px solid var(--border)" }}>
            {m.spark && <Icon name="flag" size={10} />}{m.label}
          </span>
        );
      })}
    </span>
  );
}

function StateLine({ waits, blocks, role }: { waits: number; blocks: number; role: string }) {
  const part = (n: number, sing: string, plur: string) => `${n} ${n === 1 ? sing : plur}`;
  return (
    <div>
      <div style={{ fontSize: 13, color: "var(--text-quaternary)", fontWeight: 500, marginBottom: 6 }}>
        {role === "manager" ? "Across your studio" : "Across your relays"}
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.5px", lineHeight: 1.25, margin: 0 }}>
        {waits === 0 ? (
          <>Nothing waits on you — <span style={{ color: "var(--text-tertiary)" }}>you're clear to pick up the next slice.</span></>
        ) : (
          <>
            <span>{part(waits, "thing waits", "things wait")} on you</span>
            <span style={{ color: "var(--text-quaternary)", fontWeight: 400 }}> · </span>
            <span style={{ color: blocks > 0 ? "var(--text-primary)" : "var(--text-tertiary)" }}>{part(blocks, "blocks", "block")} the team</span>
          </>
        )}
      </h1>
    </div>
  );
}

function StartHere({ a, onGo }: { a: NextItem; onGo: (t: NextTarget) => void }) {
  const [h, setH] = useState(false);
  return (
    <div onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ position: "relative", display: "flex", gap: 16, padding: "20px 22px 20px 24px", borderRadius: "var(--r-xl)",
        background: "var(--bg-elevated)", overflow: "hidden", border: "0.5px solid var(--text-primary)",
        boxShadow: h ? "var(--shadow-3)" : "var(--shadow-2)", transition: "box-shadow var(--t-reg)" }}>
      <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: "var(--text-primary)" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          {a.discipline
            ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-tertiary)" }}><DiscDot d={a.discipline} />{DISC[a.discipline]?.label}</span>
            : <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-tertiary)" }}><ZeroMark size={13} />sprint0</span>}
          {a.project && <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>· {a.project}</span>}
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.4px", lineHeight: 1.3, margin: "0 0 8px" }}>{a.title}</h2>
        <p style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.5, margin: "0 0 14px", maxWidth: 480 }}>{a.why}</p>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Chips chips={a.chips} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-tertiary)" }}>
            <Icon name="bolt" size={12} style={{ color: "var(--text-primary)" }} />{boltWhy(a)}
          </span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flexShrink: 0 }}>
        <Button variant="primary" size="lg" iconRight="arrowRight" icon={ACTION_ICON[a.action.target.kind]} onClick={() => onGo(a.action.target)}>{a.action.label}</Button>
      </div>
    </div>
  );
}

function NextRow({ a, onGo }: { a: NextItem; onGo: (t: NextTarget) => void }) {
  const [h, setH] = useState(false);
  return (
    <div onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)} onClick={() => onGo(a.action.target)}
      style={{ display: "flex", alignItems: "center", gap: 13, padding: "13px 15px", cursor: "pointer", borderRadius: "var(--r-lg)",
        background: "var(--bg-elevated)", border: "0.5px solid var(--border)", boxShadow: h ? "var(--shadow-2)" : "var(--shadow-1)",
        transform: h ? "translateY(-1px)" : "none", transition: "box-shadow var(--t-quick), transform var(--t-quick)" }}>
      <span style={{ width: 30, height: 30, flexShrink: 0, borderRadius: "var(--r-md)", display: "grid", placeItems: "center",
        background: "var(--bg-secondary)", border: "0.5px solid var(--border)" }}>
        {a.discipline ? <DiscDot d={a.discipline} size={9} /> : <Icon name="pool" size={14} style={{ color: "var(--text-tertiary)" }} />}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.title}</div>
        <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.why}</div>
      </div>
      <Chips chips={a.chips} size="sm" />
      <Button variant="secondary" size="sm" iconRight="arrowRight" onClick={(e) => { e.stopPropagation(); onGo(a.action.target); }}>{a.action.label}</Button>
    </div>
  );
}

export function Today() {
  const { next, me, role, setView }: any = useApp();
  const setPlanId = useUI((s) => s.setPlanId);
  const setActiveGate = useUI((s) => s.setActiveGate);
  const setActiveIssue = useUI((s) => s.setActiveIssue);

  const fire = (t: NextTarget) => {
    switch (t.kind) {
      case "relay": if (t.planId) setPlanId(t.planId); if (t.discipline) setActiveGate(t.discipline); setView("relay"); break;
      case "qagate": if (t.planId) setPlanId(t.planId); setView("qagate"); break;
      case "scope": if (t.taskId) setActiveIssue(t.taskId); setView("mywork"); break;
      case "reschedule": setView("inbox"); break;
      case "relays": setView("relays"); break;
    }
  };

  const start: NextItem | null = next?.startHere ?? null;
  const rest: NextItem[] = next?.next ?? [];
  const items = [start, ...rest].filter((i): i is NextItem => !!i);
  const waits = items.filter((i) => i.chips.some((c) => c.kind === "baton")).length;
  const blocks = items.filter((i) => i.chips.some((c) => c.kind === "blocks")).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ViewChrome breadcrumb={["Studio", "Today"]}>
        <div style={{ display: "flex", gap: 6, marginRight: 6 }}>
          <Tab active={true}>Today</Tab>
          <Tab active={false} onClick={() => setView("relays")}>By relay</Tab>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 26, padding: "0 10px",
          borderRadius: "var(--r-pill)", background: "var(--bg-secondary)", border: "0.5px solid var(--border)" }}>
          <Avatar name={me?.name} size={17} tone={role === "manager" ? "ink" : undefined} />
          <span className="mono" style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>
            {me?.name ? String(me.name).split(" ")[0] : "you"} · {me?.discipline || role}
          </span>
        </span>
      </ViewChrome>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "28px 28px 64px" }}>
          <StateLine waits={waits} blocks={blocks} role={role} />

          {start ? (
            <>
              <div className="kicker" style={{ display: "flex", alignItems: "center", gap: 7, margin: "26px 0 10px" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--text-primary)" }} />
                Start here
              </div>
              <StartHere a={start} onGo={fire} />
            </>
          ) : (
            <div style={{ marginTop: 26, padding: 22, textAlign: "center", border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", background: "var(--bg-secondary)" }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>You're all clear</div>
              <div style={{ fontSize: 13, color: "var(--text-tertiary)", marginTop: 4 }}>Nothing waits on you right now.</div>
            </div>
          )}

          {rest.length > 0 && (
            <>
              <div className="kicker" style={{ margin: "28px 0 10px" }}>Next · {rest.length}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {rest.map((a) => <NextRow key={a.id} a={a} onGo={fire} />)}
              </div>
            </>
          )}

          <button onClick={() => setView("relays")}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", marginTop: 22, padding: "12px 14px",
              borderRadius: "var(--r-lg)", border: "0.5px dashed var(--border-strong)", textAlign: "left", transition: "background var(--t-quick)" }}>
            <Icon name="pool" size={16} style={{ color: "var(--text-tertiary)" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)" }}>By relay</div>
              <div style={{ fontSize: 11.5, color: "var(--text-quaternary)" }}>See every active relay ranked in the cross-project pool</div>
            </div>
            <Icon name="arrowRight" size={15} style={{ color: "var(--text-quaternary)" }} />
          </button>
        </div>
      </div>
    </div>
  );
}
