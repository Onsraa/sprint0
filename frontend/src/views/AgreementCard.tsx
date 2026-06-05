/* sprint0 — the Contract card: a NEGOTIABLE interface contract (the CDD blueprint two disciplines agree on).
   It's a mini-gate: the PRODUCER picks a shape (reuse / fresh / write-own) + signs async ("sent", not
   "waiting"); the CONSUMER agrees (→ compounded) or COUNTER-proposes a different shape + a one-line why,
   which bounces back to the producer → the cycle. Self-contained: it runs its own sign/agree/counter/reject. */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge, Button, DISC } from "../components/ui";
import { Icon } from "../lib/icon";
import { api } from "../lib/api";
import type { Agreement, InterfaceProposal } from "../lib/schemas";

const SIG: Record<string, string> = {
  ratified: "var(--green)", auto_passed: "var(--green)", active: "var(--blue)", proposed: "var(--amber)", rejected: "var(--red)", superseded: "var(--text-quaternary)",
};
type Field = { name: string; type: string; required?: boolean };

export function AgreementCard({ a, me, compact = false }: { a: Agreement; me?: any; compact?: boolean }) {
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: ["planAgreements", a.plan_id] }); qc.invalidateQueries({ queryKey: ["myAgreements"] }); };
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => refresh(),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const busy = run.isPending;

  const myDisc: string | undefined = me?.discipline;
  const isProducer = !!myDisc && myDisc === a.producer_discipline;
  const isConsumer = !!myDisc && myDisc === a.consumer_discipline;
  const isRatifier = (a.ratifiers ?? []).includes(me?.username);
  const ratifs: any[] = (a.ratifications ?? []) as any[];
  const lastCounter = [...ratifs].reverse().find((r) => r.kind === "counter");
  const proposals = a.proposals ?? [];
  const consumerName = a.consumer_discipline ? DISC[a.consumer_discipline]?.label : "the consumer";

  // producer's initial pick (picker mode)
  const [picked, setPicked] = useState<string | null>(a.chosen_proposal_id ?? proposals[0]?.id ?? null);
  // counter panel (consumer / producer counter)
  const [countering, setCountering] = useState(false);
  const [counterPick, setCounterPick] = useState<string | null>(null);
  const [counterWhy, setCounterWhy] = useState("");

  const sign = () => picked && run.mutate(() => api.signAgreement(a.id, picked));
  const agree = () => run.mutate(() => api.ratifyAgreement(a.id, "ratified"));
  const reject = () => run.mutate(() => api.ratifyAgreement(a.id, "rejected"));
  const submitCounter = () => run.mutate(() =>
    api.counterAgreement(a.id, { proposal_id: counterPick ?? undefined, why: counterWhy.trim() }).then(() => { setCountering(false); setCounterWhy(""); }));

  // which mode is this viewer in?
  const done = a.state === "ratified" || a.state === "auto_passed";
  const rejected = a.state === "rejected";
  const producerPicks = isProducer && a.state === "proposed" && proposals.length > 0 && !lastCounter;
  const producerSeesCounter = isProducer && a.state === "proposed" && !!lastCounter;
  const consumerActs = isConsumer && isRatifier && a.state === "active";
  const producerSent = isProducer && a.state === "active";

  return (
    <div style={{ borderRadius: "var(--r-lg)", border: "0.5px solid var(--border)", background: "var(--bg-elevated)", boxShadow: compact ? "none" : "var(--shadow-1)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: compact ? "9px 12px" : "11px 13px", borderBottom: "0.5px solid var(--border-subtle)" }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: SIG[a.state] ?? "var(--text-quaternary)", flexShrink: 0 }} />
        <span className="mono" style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-quaternary)" }}>Contract</span>
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0 }}>{a.subject}</span>
        {done && <Badge tone="green"><Icon name="check" size={10} />agreed</Badge>}
        {a.state === "active" && <Badge tone="blue"><Icon name="relay" size={10} />signed</Badge>}
        {rejected && <Badge tone="red">declined</Badge>}
      </div>

      {/* PRODUCER PICKER — choose the shape (reuse / fresh) + sign */}
      {producerPicks ? (
        <div style={{ padding: "12px 13px" }}>
          <div className="kicker" style={{ marginBottom: 8 }}>Pick the shape to send · {proposals.length}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {proposals.map((p) => <ProposalCard key={p.id} p={p} selected={picked === p.id} onSelect={() => setPicked(p.id)} />)}
          </div>
        </div>
      ) : (
        /* the current agreed/proposed shape */
        a.interface && <InterfaceBody c={a.interface} />
      )}

      {/* counter banner (producer sees what the consumer countered + why) */}
      {producerSeesCounter && lastCounter && (
        <div style={{ display: "flex", gap: 8, padding: "9px 13px", background: "var(--bg-active)", borderTop: "0.5px solid var(--border-subtle)" }}>
          <Icon name="arrowRight" size={13} style={{ color: "var(--text-primary)", flexShrink: 0, marginTop: 1, transform: "rotate(180deg)" }} />
          <span style={{ fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.45 }}>
            <b>@{lastCounter.by}</b> countered{lastCounter.note ? <> — {lastCounter.note}</> : ""}. Agree to their shape, or counter back.
          </span>
        </div>
      )}

      {/* counter panel — pick an alternative proposal + a one-line why */}
      {countering && (
        <div style={{ padding: "11px 13px", borderTop: "0.5px solid var(--border-subtle)", background: "var(--bg-secondary)" }}>
          <div className="kicker" style={{ marginBottom: 7 }}>Counter with a different shape</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 9 }}>
            {proposals.filter((p) => p.id !== a.chosen_proposal_id).map((p) => <ProposalCard key={p.id} p={p} selected={counterPick === p.id} onSelect={() => setCounterPick(p.id)} compact />)}
          </div>
          <input value={counterWhy} onChange={(e) => setCounterWhy(e.target.value)} placeholder="Why this shape instead — one line"
            style={{ width: "100%", height: 30, padding: "0 9px", fontSize: 12, border: "0.5px solid var(--border-strong)", borderRadius: "var(--r-md)", background: "var(--bg-elevated)", fontFamily: "inherit", marginBottom: 8 }} />
          <div style={{ display: "flex", gap: 7 }}>
            <Button variant="primary" size="sm" icon="arrowRight" disabled={busy || (!counterPick && !counterWhy.trim())} onClick={submitCounter}>Send counter</Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setCountering(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* footer — the action row, by mode */}
      {!countering && (
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 13px", borderTop: "0.5px solid var(--border-subtle)" }}>
          <span style={{ fontSize: 11, color: "var(--text-tertiary)", flex: 1, minWidth: 0 }}>
            {done ? "Agreed — the mock is live, both sides build to this." :
             rejected ? "Declined — no contract here." :
             producerSent ? `Signed by you · sent to ${consumerName} — they agree or counter.` :
             producerPicks ? "Pick a shape, then send it to the consumer." :
             consumerActs ? `${DISC[a.producer_discipline ?? ""]?.label ?? "The producer"} signed — agree, or counter your own.` :
             producerSeesCounter ? "Your move — agree to the counter, or counter back." :
             "Awaiting the producer."}
          </span>
          {producerPicks && <Button variant="primary" size="sm" icon="check" disabled={busy || !picked} onClick={sign}>Sign + send</Button>}
          {(consumerActs || producerSeesCounter) && <>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setCountering(true)}>Counter</Button>
            {consumerActs && <Button variant="ghost" size="sm" disabled={busy} onClick={reject}>Reject</Button>}
            <Button variant="primary" size="sm" icon="check" disabled={busy} onClick={agree}>Agree</Button>
          </>}
        </div>
      )}
    </div>
  );
}

/* per-file change kind → a diff-style symbol + color (add green + · modify amber ~ · remove red −) */
const FC_SYM: Record<string, string> = { add: "+", modify: "~", remove: "−" };
const FC_COLOR: Record<string, string> = { add: "var(--green)", modify: "var(--amber)", remove: "var(--red)" };

/* a pickable shape proposal — source badge · method+path · why · the files it touches · pros/cons. */
function ProposalCard({ p, selected, onSelect, compact = false }: { p: InterfaceProposal; selected: boolean; onSelect: () => void; compact?: boolean }) {
  const srcMeta: Record<string, { label: string; tone: any }> = {
    memory: { label: "reuse · memory", tone: "green" }, ai: { label: "fresh · ai", tone: "amber" }, user: { label: "your own", tone: "ink" },
  };
  const m = srcMeta[p.source] ?? srcMeta.ai;
  return (
    <button onClick={onSelect}
      style={{ display: "block", width: "100%", textAlign: "left", padding: compact ? "8px 10px" : "10px 12px", borderRadius: "var(--r-md)",
        border: `0.5px solid ${selected ? "var(--text-primary)" : "var(--border)"}`, boxShadow: selected ? "0 0 0 1px var(--text-primary)" : "none",
        background: selected ? "var(--bg-active)" : "var(--bg-secondary)", transition: "border-color var(--t-quick)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
        <span className="mono" style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-quaternary)" }}>{m.label}</span>
        {p.grounded_on && p.grounded_on.length > 0 && <span style={{ fontSize: 10, color: "var(--text-quaternary)" }}>· {p.grounded_on.join(" · ")}</span>}
        <div style={{ flex: 1 }} />
        {typeof p.confidence === "number" && <span className="mono" style={{ fontSize: 10, color: "var(--text-quaternary)" }}>{p.confidence}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Badge tone="ink" mono>{p.interface.method}</Badge>
        <span className="mono" style={{ fontSize: 12, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.interface.path}</span>
      </div>
      {p.why && <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 4, lineHeight: 1.4 }}>{p.why}</div>}
      {(p.file_changes?.length ?? 0) > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 6 }}>
          {(p.file_changes ?? []).map((fc) => (
            <div key={fc.path} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5 }}>
              <span className="mono" style={{ color: FC_COLOR[fc.change ?? "modify"], fontWeight: 700, width: 8, textAlign: "center", flexShrink: 0 }}>{FC_SYM[fc.change ?? "modify"]}</span>
              <span className="mono" style={{ color: "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fc.path}</span>
            </div>
          ))}
        </div>
      )}
      {!compact && ((p.pros?.length ?? 0) > 0 || (p.cons?.length ?? 0) > 0) && (
        <div style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 11 }}>
          {(p.pros ?? []).length > 0 && <span style={{ color: "var(--text-tertiary)" }}><b style={{ color: "var(--green)" }}>+</b> {(p.pros ?? []).join(" · ")}</span>}
          {(p.cons ?? []).length > 0 && <span style={{ color: "var(--text-tertiary)" }}><b style={{ color: "var(--amber)" }}>−</b> {(p.cons ?? []).join(" · ")}</span>}
        </div>
      )}
    </button>
  );
}

/* The agreed API blueprint — method + path always; request/response/error tables collapse on demand. */
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
