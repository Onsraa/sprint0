/* sprint0 — Queue: the merged Today + Inbox (the frictionless-workflow home). One ranked, role-filtered
   action queue — baton-on-you → blocks-the-team → up-next → FYI — with an ACT-IN-PLACE detail pane beside
   the list: a gate → RatifyPanel, an interface contract → AgreementCard, a reschedule → the consent UI,
   a notification → its detail. Never navigate away. Ported from the v6 design Queue.jsx; combines the
   Today ranking (useApp().next) + the Inbox feeds (agreements / reschedule / notifications). */
import { useState, useMemo } from "react";
import { useApp } from "../app/useApp";
import { useUI } from "../lib/store";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { toast } from "sonner";
import { Icon } from "../lib/icon";
import { DiscDot, DISC } from "../components/ui";
import { ViewChrome } from "../components/ViewChrome";
import { AgreementCard } from "./AgreementCard";
import { RatifyPanel } from "./RatifyPanel";
import { RescheduleConsent, InboxDetail } from "./InboxPage";
import type { NextItem, NextChip } from "../features/today/rank";

const TIERS = [
  { id: 0, label: "On you now", hint: "the baton, your call" },
  { id: 1, label: "Blocks the team", hint: "downstream legs wait" },
  { id: 2, label: "Up next", hint: "scheduled · your work" },
  { id: 3, label: "FYI", hint: "no action needed" },
];

type QItem =
  | { key: string; tier: number; kind: "action"; item: NextItem }
  | { key: string; tier: number; kind: "agreement"; agreement: any }
  | { key: string; tier: number; kind: "reschedule" }
  | { key: string; tier: number; kind: "notif"; notif: any };

const tierOf = (it: NextItem): number =>
  it.chips.some((c: NextChip) => c.kind === "baton" || c.kind === "consent") ? 0
    : it.chips.some((c: NextChip) => c.kind === "blocks") ? 1 : 2;

const NEEDS = ["ratify", "ratify_needed", "blocked", "reschedule", "reschedule_proposed"];

export function Queue() {
  const { next, me, role, notifs, gates, proposal, setView }: any = useApp();
  const setPlanId = useUI((s) => s.setPlanId);
  const setActiveGate = useUI((s) => s.setActiveGate);
  const qc = useQueryClient();
  const { data: agData } = useQuery({ queryKey: ["myAgreements"], queryFn: () => api.myAgreements() });
  const agreements = agData?.agreements ?? [];
  const ratifyAg = useMutation({
    mutationFn: ({ id, d }: { id: string; d: "ratified" | "rejected" }) => api.ratifyAgreement(id, d),
    onSuccess: (_r, v) => { qc.invalidateQueries({ queryKey: ["myAgreements"] }); toast.success(v.d === "ratified" ? "Ratified" : "Rejected"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const items: QItem[] = useMemo(() => {
    const actions: NextItem[] = [next?.startHere, ...(next?.next ?? [])].filter(Boolean);
    const out: QItem[] = actions.map((a) => ({ key: "act:" + a.id, tier: tierOf(a), kind: "action", item: a }));
    agreements.forEach((a: any) => out.push({ key: "agr:" + a.id, tier: 0, kind: "agreement", agreement: a }));
    if (proposal && proposal.status === "pending") out.push({ key: "rsc", tier: 0, kind: "reschedule" });
    (notifs ?? []).filter((n: any) => !NEEDS.includes(n.kind)).forEach((n: any) => out.push({ key: "ntf:" + n.id, tier: 3, kind: "notif", notif: n }));
    return out;
  }, [next, agreements, proposal, notifs]);

  const [selKey, setSelKey] = useState<string | null>(null);
  const sel = items.find((i) => i.key === selKey) ?? items.find((i) => i.tier < 3) ?? items[0] ?? null;

  const select = (i: QItem) => {
    setSelKey(i.key);
    if (i.kind === "action" && i.item.action.target.kind === "relay") {  // point the active plan/gate → RatifyPanel renders it in place
      const t = i.item.action.target;
      if (t.planId) setPlanId(t.planId);
      if (t.discipline) setActiveGate(t.discipline);
    }
  };

  const byTier = TIERS.map((t) => ({ ...t, rows: items.filter((i) => i.tier === t.id) }));
  const onYou = items.filter((i) => i.tier === 0).length;
  const blocking = items.filter((i) => i.tier === 1).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ViewChrome breadcrumb={["Studio", "Queue"]} />
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ width: 392, flexShrink: 0, borderRight: "0.5px solid var(--border)", overflow: "auto" }}>
          <QueueState onYou={onYou} blocking={blocking} role={role} />
          {byTier.map((t) => t.rows.length > 0 && (
            <QueueGroup key={t.id} tier={t}>
              {t.rows.map((i) => <QueueRow key={i.key} item={i} active={i.key === sel?.key} onClick={() => select(i)} />)}
            </QueueGroup>
          ))}
          {!items.length && <div style={{ padding: 28, textAlign: "center", color: "var(--text-tertiary)", fontSize: 13 }}>You're all clear — nothing waits on you.</div>}
        </div>
        <div style={{ flex: 1, minWidth: 0, overflow: "auto" }}>
          {sel ? <QueueDetail item={sel} gates={gates} me={me} agRatify={ratifyAg} setView={setView} /> : null}
        </div>
      </div>
    </div>
  );
}

function QueueState({ onYou, blocking, role }: { onYou: number; blocking: number; role: string }) {
  return (
    <div style={{ padding: "18px 18px 12px", borderBottom: "0.5px solid var(--border-subtle)" }}>
      <div style={{ fontSize: 12, color: "var(--text-quaternary)", fontWeight: 500, marginBottom: 5 }}>{role === "manager" ? "Across your studio" : "Across your relays"}</div>
      <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.3px" }}>
        {onYou === 0 ? <span style={{ color: "var(--text-tertiary)" }}>Nothing waits on you</span>
          : <><span>{onYou} on you</span><span style={{ color: "var(--text-quaternary)", fontWeight: 400 }}> · </span><span style={{ color: blocking > 0 ? "var(--text-primary)" : "var(--text-tertiary)" }}>{blocking} block the team</span></>}
      </div>
    </div>
  );
}

function QueueGroup({ tier, children }: { tier: { id: number; label: string; hint: string }; children: React.ReactNode }) {
  const spark = tier.id === 0;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 16px", position: "sticky", top: 0, background: "var(--bg-elevated)", zIndex: 1 }}>
        {spark && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--text-primary)" }} />}
        <span style={{ fontSize: 12, fontWeight: 600, color: spark ? "var(--text-primary)" : "var(--text-tertiary)" }}>{tier.label}</span>
        <span className="mono" style={{ fontSize: 10, color: "var(--text-quaternary)" }}>{tier.hint}</span>
      </div>
      {children}
    </div>
  );
}

function QueueRow({ item, active, onClick }: { item: QItem; active: boolean; onClick: () => void }) {
  const [h, setH] = useState(false);
  let glyph: React.ReactNode = <Icon name="bell" size={16} style={{ color: "var(--text-tertiary)" }} />;
  let title = "", sub = "", chips: NextChip[] = [];
  if (item.kind === "action") {
    glyph = item.item.discipline ? <DiscDot d={item.item.discipline} size={9} /> : <Icon name="pool" size={15} style={{ color: "var(--text-tertiary)" }} />;
    title = item.item.title; sub = item.item.why; chips = item.item.chips;
  } else if (item.kind === "agreement") {
    glyph = <Icon name="relay" size={16} style={{ color: "var(--text-primary)" }} />;
    title = item.agreement.subject || "Interface contract"; sub = "an API two disciplines sign";
  } else if (item.kind === "reschedule") {
    glyph = <Icon name="calendar" size={16} style={{ color: "var(--text-primary)" }} />;
    title = "Reflow proposed"; sub = "review the AI reschedule — your consent";
  } else {
    glyph = <Icon name="bell" size={16} style={{ color: "var(--text-tertiary)" }} />;
    title = item.notif.title; sub = item.notif.body;
  }
  return (
    <div onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: "flex", gap: 11, padding: "11px 16px", cursor: "pointer", background: active || h ? "var(--bg-hover)" : "transparent", borderBottom: "0.5px solid var(--border-subtle)" }}>
      <span style={{ marginTop: 1, display: "inline-flex" }}>{glyph}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
        {chips.length > 0 && <div style={{ display: "flex", gap: 5, marginTop: 6 }}>{chips.map((c, i) => <QChip key={i} c={c} />)}</div>}
      </div>
    </div>
  );
}

function QChip({ c }: { c: NextChip }) {
  const spark = c.kind === "baton";
  const label = c.kind === "baton" ? "baton" : c.kind === "blocks" ? `blocks ${c.n}` : c.kind;
  return (
    <span className="mono" style={{ display: "inline-flex", alignItems: "center", gap: 3, height: 17, padding: "0 7px", borderRadius: "var(--r-pill)", fontSize: 10, fontWeight: 600,
      background: spark ? "var(--ink-fill)" : "var(--bg-secondary)", color: spark ? "#fff" : "var(--text-tertiary)", border: spark ? "none" : "0.5px solid var(--border)" }}>
      {spark && <Icon name="flag" size={9} />}{label}
    </span>
  );
}

/* the act-in-place detail pane — each kind renders its real action UI, no navigation */
function QueueDetail({ item, gates, me, agRatify, setView }: { item: QItem; gates: any; me: any; agRatify: any; setView: (v: string) => void }) {
  if (item.kind === "agreement") {
    const a = item.agreement;
    const canSign = a.state === "proposed" && (a.ratifiers ?? []).includes(me.username);
    return <div style={{ padding: 28, maxWidth: 600 }}><AgreementCard a={a} busy={agRatify.isPending}
      onRatify={canSign ? () => agRatify.mutate({ id: a.id, d: "ratified" }) : undefined}
      onReject={canSign ? () => agRatify.mutate({ id: a.id, d: "rejected" }) : undefined} /></div>;
  }
  if (item.kind === "reschedule") return <div style={{ padding: 28 }}><RescheduleConsent /></div>;
  if (item.kind === "notif") return <div style={{ padding: 28 }}><InboxDetail n={item.notif} go={setView} onSnooze={() => toast("Snoozed")} /></div>;
  // an action: a gate renders RatifyPanel in place (the active plan/gate was pointed on select)
  const t = item.item.action.target;
  if (t.kind === "relay") {
    const gate = (gates ?? []).find((g: any) => g.discipline === t.discipline);
    if (gate) return <RatifyPanel g={gate} />;
  }
  return <SimpleActionDetail item={item.item} setView={setView} />;
}

function SimpleActionDetail({ item, setView }: { item: NextItem; setView: (v: string) => void }) {
  const t = item.action.target;
  const go = () => { setView(t.kind === "qagate" ? "qagate" : t.kind === "scope" ? "mywork" : t.kind === "relays" ? "relays" : "relay"); };
  return (
    <div style={{ padding: 28, maxWidth: 560 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        {item.discipline ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-tertiary)" }}><DiscDot d={item.discipline} />{DISC[item.discipline]?.label}</span> : null}
        {item.project && <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>· {item.project}</span>}
      </div>
      <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.4px", margin: "0 0 8px" }}>{item.title}</h1>
      <p style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.5, margin: "0 0 16px" }}>{item.why}</p>
      <button onClick={go} style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 34, padding: "0 14px", borderRadius: "var(--r-md)", background: "var(--ink-fill)", color: "#fff", fontSize: 13, fontWeight: 500 }}>
        {item.action.label}<Icon name="arrowRight" size={15} />
      </button>
    </div>
  );
}
