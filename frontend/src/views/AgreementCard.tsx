/* sprint0 — the Agreement Card: renders a coordination agreement (first: the INTERFACE CONTRACT — the
   CDD blueprint two disciplines ratify before building) + the two-party ratify state. Reuses the design's
   card shell; the API-blueprint body (method/path + request/response field tables + errors) is the new part. */
import { useState } from "react";
import { Badge, Button } from "../components/ui";
import { Icon } from "../lib/icon";
import type { Agreement } from "../lib/schemas";

const SIG: Record<string, string> = {
  ratified: "var(--green)", auto_passed: "var(--green)", proposed: "var(--amber)", rejected: "var(--red)",
};

type Field = { name: string; type: string; required?: boolean };

export function AgreementCard({ a, onRatify, onReject, busy }: {
  a: Agreement; onRatify?: () => void; onReject?: () => void; busy?: boolean;
}) {
  const c = a.interface;
  const signed = (a.ratifications ?? []).filter((r: any) => r.decision === "ratified").map((r: any) => r.by);
  const waiting = (a.ratifiers ?? []).filter((u) => !signed.includes(u));
  return (
    <div style={{ borderRadius: "var(--r-lg)", border: "0.5px solid var(--border)", background: "var(--bg-elevated)", boxShadow: "var(--shadow-1)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "11px 13px", borderBottom: "0.5px solid var(--border-subtle)" }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: SIG[a.state] ?? "var(--text-quaternary)", flexShrink: 0 }} />
        <span className="mono" style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-quaternary)" }}>{a.type === "subteam" ? "Sub-team" : "Contract"}</span>
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0 }}>{a.subject}</span>
        {a.state === "ratified" && <Badge tone="green"><Icon name="check" size={10} />both signed</Badge>}
        {a.state === "auto_passed" && <Badge tone="ink"><Icon name="relay" size={10} />compounded</Badge>}
      </div>
      {a.subteam && (
        <div style={{ padding: "12px 13px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
            <Badge tone="ink" mono>{a.subteam.mode}</Badge>
            <span style={{ fontSize: 12.5, color: "var(--text-primary)" }}>{(a.subteam.members ?? []).join(" + ")}</span>
          </div>
          {a.subteam.rationale && <div style={{ fontSize: 12, color: "var(--text-tertiary)", lineHeight: 1.45 }}>{a.subteam.rationale}</div>}
        </div>
      )}
      {c && <InterfaceBody c={c} />}
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 13px", borderTop: "0.5px solid var(--border-subtle)" }}>
        <span style={{ fontSize: 11, color: "var(--text-tertiary)", flex: 1, minWidth: 0 }}>
          {a.state === "auto_passed" ? "Auto-passed — the agency ratified this shape before; compounded, no meeting." :
           a.state === "ratified" ? "Ratified — the mock is live; both sides build to this." :
           waiting.length ? `Waiting on ${waiting.join(", ")}` : "Both leads must sign."}
        </span>
        {onReject && a.state === "proposed" && <Button variant="ghost" size="sm" disabled={busy} onClick={onReject}>Reject</Button>}
        {onRatify && a.state === "proposed" && <Button variant="primary" size="sm" icon="check" disabled={busy} onClick={onRatify}>Ratify</Button>}
      </div>
    </div>
  );
}

/* The API blueprint — method + path always shown; the request/response/error tables collapse on demand
   (the card reads as a shape header, not a wall of tables — esp. inside the gate's folded contracts). */
function InterfaceBody({ c }: { c: any }) {
  const [open, setOpen] = useState(false);
  const n = (c.request_fields?.length ?? 0) + (c.response_fields?.length ?? 0) + (c.errors?.length ?? 0);
  return (
    <div style={{ padding: "12px 13px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: open ? 8 : 0 }}>
        <Badge tone="ink" mono>{c.method}</Badge>
        <span className="mono" style={{ fontSize: 12.5, color: "var(--text-primary)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.path}</span>
        <button onClick={() => setOpen((o) => !o)} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 500, color: "var(--text-tertiary)" }}>
          {open ? "Hide" : "Shape"} · {n} field{n === 1 ? "" : "s"}
          <Icon name="chevronDown" size={12} style={{ color: "var(--text-quaternary)", transform: open ? "none" : "rotate(-90deg)", transition: "transform var(--t-quick)" }} />
        </button>
      </div>
      {open && <>
        <FieldTable label="Request" fields={c.request_fields as Field[]} />
        <FieldTable label="Response" fields={c.response_fields as Field[]} />
        {!!c.errors?.length && (
          <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 5 }}>
            {c.errors.map((e: string) => <span key={e} className="mono" style={{ fontSize: 10, color: "var(--text-tertiary)", background: "var(--bg-secondary)", padding: "2px 6px", borderRadius: "var(--r-xs)" }}>{e}</span>)}
          </div>
        )}
      </>}
    </div>
  );
}

function FieldTable({ label, fields }: { label: string; fields: Field[] }) {
  if (!fields?.length) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <div className="mono" style={{ fontSize: 9.5, color: "var(--text-quaternary)", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {fields.map((f) => (
          <div key={f.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5 }}>
            <span className="mono" style={{ color: "var(--text-primary)" }}>{f.name}</span>
            <span className="mono" style={{ color: "var(--text-tertiary)" }}>{f.type}</span>
            {f.required === false && <span style={{ fontSize: 10, color: "var(--text-quaternary)" }}>optional</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
