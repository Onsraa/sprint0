/* sprint0 — the Contract card: a NEGOTIABLE interface contract (the CDD blueprint two disciplines agree on).
   A contract is the INTERFACE PROMISE (method · path · request/response · errors) — NOT files (files are the
   gate's footprint). It's a mini-gate: the PRODUCER picks a shape (reuse / fresh / write-your-own) + signs
   async ("sent", not "waiting"); the CONSUMER agrees (→ compounded) or COUNTER-proposes a different shape + a
   one-line why, which bounces back → the cycle. Both write-own + counter use the same InterfaceEditor. */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge, Button, DISC } from "../components/ui";
import { isDone } from "../lib/gate";
import { Icon } from "../lib/icon";
import { api } from "../lib/api";
import type { Agreement, InterfaceProposal, InterfaceDraft } from "../lib/schemas";

const SIG: Record<string, string> = {
  ratified: "var(--green)", auto_passed: "var(--green)", active: "var(--blue)", proposed: "var(--amber)", rejected: "var(--red)", superseded: "var(--text-quaternary)",
};
type Field = { name: string; type: string; required?: boolean };
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const TYPES = ["string", "number", "integer", "boolean", "object", "array", "null"];
const emptyDraft = (): InterfaceDraft => ({ method: "POST", path: "", request_fields: [], response_fields: [], errors: [] });

export function AgreementCard({ a, me, compact = false }: { a: Agreement; me?: any; compact?: boolean }) {
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: ["planAgreements", a.plan_id] }); qc.invalidateQueries({ queryKey: ["myAgreements"] }); };
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => refresh(),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const busy = run.isPending;

  // the ACTORS: each side's gate ratifier (delegate ?? owner ?? lane lead — may be out-of-discipline when
  // availability stretched the work). Username first; discipline fallback for legacy agreements w/o actors.
  const myDisc: string | undefined = me?.discipline;
  const isProducer = a.producer_actor ? me?.username === a.producer_actor : (!!myDisc && myDisc === a.producer_discipline);
  const isConsumer = a.consumer_actor ? me?.username === a.consumer_actor : (!!myDisc && myDisc === a.consumer_discipline);
  const isRatifier = (a.ratifiers ?? []).includes(me?.username);
  const ratifs: any[] = (a.ratifications ?? []) as any[];
  const lastCounter = [...ratifs].reverse().find((r) => r.kind === "counter");
  const proposals = a.proposals ?? [];
  const consumerName = a.consumer_actor ? `@${a.consumer_actor}` : (a.consumer_discipline ? DISC[a.consumer_discipline]?.label : "the consumer");

  // producer's initial pick — a proposal id, or "user" for write-your-own
  const [picked, setPicked] = useState<string | null>(a.chosen_proposal_id ?? proposals[0]?.id ?? null);
  const [draft, setDraft] = useState<InterfaceDraft>(emptyDraft);
  // counter panel (consumer / producer) — pick a proposal OR author a shape
  const [countering, setCountering] = useState(false);
  const [counterPick, setCounterPick] = useState<string | null>(null);
  const [counterDraft, setCounterDraft] = useState<InterfaceDraft | null>(null);
  const [counterWhy, setCounterWhy] = useState("");

  const sign = () => {
    if (picked === "user") { if (draft.path.trim()) run.mutate(() => api.signAgreement(a.id, { interface: draft })); }
    else if (picked) run.mutate(() => api.signAgreement(a.id, { proposal_id: picked }));
  };
  const agree = () => run.mutate(() => api.ratifyAgreement(a.id, "ratified"));
  const reject = () => run.mutate(() => api.ratifyAgreement(a.id, "rejected"));
  const submitCounter = () => run.mutate(() =>
    api.counterAgreement(a.id, {
      proposal_id: counterDraft ? undefined : (counterPick ?? undefined),
      interface: counterDraft ?? undefined, why: counterWhy.trim(),
    }).then(() => { setCountering(false); setCounterWhy(""); setCounterDraft(null); }));

  // which mode is this viewer in?
  const done = isDone(a.state);
  // one person owns BOTH ends (an availability stretch) → their single sign auto-completes it (no counterpart
  // to negotiate with). Label it so "agreed" on a fresh dispatch isn't surprising.
  const sameOwner = !!a.producer_actor && a.producer_actor === a.consumer_actor;
  const rejected = a.state === "rejected";
  const producerPicks = isProducer && a.state === "proposed" && proposals.length > 0 && !lastCounter;
  const producerSeesCounter = isProducer && a.state === "proposed" && !!lastCounter;
  const consumerActs = isConsumer && isRatifier && a.state === "active";
  const producerSent = isProducer && a.state === "active";
  const canSign = picked === "user" ? !!draft.path.trim() : !!picked;
  const canCounter = counterDraft ? !!counterDraft.path.trim() : (!!counterPick || !!counterWhy.trim());

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

      {/* PRODUCER PICKER — choose the shape (reuse / fresh / write-your-own) + sign */}
      {producerPicks ? (
        <div style={{ padding: "12px 13px" }}>
          <div className="kicker" style={{ marginBottom: 8 }}>Pick the API shape to send · {proposals.length + 1}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {proposals.map((p) => <ProposalCard key={p.id} p={p} selected={picked === p.id} onSelect={() => setPicked(p.id)} />)}
            <WriteOwnSlot selected={picked === "user"} onSelect={() => setPicked("user")} />
          </div>
          {picked === "user" && <InterfaceEditor value={draft} onChange={setDraft} agreementId={a.id} />}
        </div>
      ) : (
        /* the current agreed/proposed shape — the interface promise */
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

      {/* counter panel — pick an alternative shape OR author your own + a one-line why */}
      {countering && (
        <div style={{ padding: "11px 13px", borderTop: "0.5px solid var(--border-subtle)", background: "var(--bg-secondary)" }}>
          <div className="kicker" style={{ marginBottom: 7 }}>Counter with a different shape</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 9 }}>
            {proposals.filter((p) => p.id !== a.chosen_proposal_id).map((p) =>
              <ProposalCard key={p.id} p={p} selected={!counterDraft && counterPick === p.id} onSelect={() => { setCounterPick(p.id); setCounterDraft(null); }} compact />)}
            <WriteOwnSlot selected={!!counterDraft} onSelect={() => { setCounterDraft(counterDraft ?? emptyDraft()); setCounterPick(null); }} />
          </div>
          {counterDraft && <div style={{ marginBottom: 9 }}><InterfaceEditor value={counterDraft} onChange={setCounterDraft} agreementId={a.id} /></div>}
          <input value={counterWhy} onChange={(e) => setCounterWhy(e.target.value)} placeholder="Why this shape instead — one line"
            style={inputStyle} />
          <div style={{ display: "flex", gap: 7, marginTop: 8 }}>
            <Button variant="primary" size="sm" icon="arrowRight" disabled={busy || !canCounter} onClick={submitCounter}>Send counter</Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setCountering(false); setCounterDraft(null); }}>Cancel</Button>
          </div>
        </div>
      )}

      {/* footer — the action row, by mode */}
      {!countering && (
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 13px", borderTop: "0.5px solid var(--border-subtle)" }}>
          <span style={{ fontSize: 11, color: "var(--text-tertiary)", flex: 1, minWidth: 0 }}>
            {done ? (sameOwner ? "Both ends are yours — agreed automatically (no counterpart to negotiate)." : "Agreed — the mock is live, both sides build to this.") :
             rejected ? "Declined — no contract here." :
             producerSent ? `Signed by you · sent to ${consumerName} — they agree or counter.` :
             producerPicks ? "Pick a shape (or write your own), then send it to the consumer." :
             consumerActs ? `${a.producer_actor ? `@${a.producer_actor}` : DISC[a.producer_discipline ?? ""]?.label ?? "The producer"} signed — agree, or counter your own.` :
             producerSeesCounter ? "Your move — agree to the counter, or counter back." :
             `Awaiting ${a.producer_actor ? `@${a.producer_actor}` : "the producer"}.`}
          </span>
          {producerPicks && <Button variant="primary" size="sm" icon="check" disabled={busy || !canSign} onClick={sign}>Sign + send</Button>}
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

const inputStyle: React.CSSProperties = { width: "100%", height: 30, padding: "0 9px", fontSize: 12, border: "0.5px solid var(--border-strong)", borderRadius: "var(--r-md)", background: "var(--bg-elevated)", fontFamily: "inherit" };

/* a pickable shape proposal — source · method+path · why · the API shape (request/response on demand). No files. */
function ProposalCard({ p, selected, onSelect, compact = false }: { p: InterfaceProposal; selected: boolean; onSelect: () => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const c: any = p.interface ?? {};
  const nFields = (c.request_fields?.length ?? 0) + (c.response_fields?.length ?? 0);
  const srcMeta: Record<string, { label: string }> = { memory: { label: "reuse · memory" }, ai: { label: "fresh · ai" }, user: { label: "your own" } };
  const m = srcMeta[p.source] ?? srcMeta.ai;
  return (
    <div onClick={onSelect} role="button"
      style={{ width: "100%", textAlign: "left", padding: compact ? "8px 10px" : "10px 12px", borderRadius: "var(--r-md)", cursor: "pointer",
        border: `0.5px solid ${selected ? "var(--text-primary)" : "var(--border)"}`, boxShadow: selected ? "0 0 0 1px var(--text-primary)" : "none",
        background: selected ? "var(--bg-active)" : "var(--bg-secondary)", transition: "border-color var(--t-quick)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
        <span className="mono" style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-quaternary)" }}>{m.label}</span>
        {p.grounded_on && p.grounded_on.length > 0 && <span style={{ fontSize: 10, color: "var(--text-quaternary)" }}>· {p.grounded_on.join(" · ")}</span>}
        <div style={{ flex: 1 }} />
        {typeof p.confidence === "number" && <span className="mono" style={{ fontSize: 10, color: "var(--text-quaternary)" }}>{p.confidence}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Badge tone="ink" mono>{c.method}</Badge>
        <span className="mono" style={{ fontSize: 12, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.path}</span>
      </div>
      {p.why && <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 4, lineHeight: 1.4 }}>{p.why}</div>}
      {/* the API shape — what the consumer builds against; detail on demand (no files; files belong to the gate) */}
      {nFields > 0 && (
        <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 6 }}>
          <button onClick={() => setOpen((o) => !o)} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 500, color: "var(--text-tertiary)" }}>
            {open ? "Hide shape" : "Shape"} · {nFields} field{nFields === 1 ? "" : "s"}
            <Icon name="chevronDown" size={11} style={{ color: "var(--text-quaternary)", transform: open ? "none" : "rotate(-90deg)", transition: "transform var(--t-quick)" }} />
          </button>
          {open && <>
            <FieldTable label="Request" fields={c.request_fields as Field[]} />
            <FieldTable label="Response" fields={c.response_fields as Field[]} />
            {!!c.errors?.length && <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 5 }}>{c.errors.map((e: string) => <span key={e} className="mono" style={{ fontSize: 9.5, color: "var(--text-tertiary)", background: "var(--bg-elevated)", padding: "2px 6px", borderRadius: "var(--r-xs)" }}>{e}</span>)}</div>}
          </>}
        </div>
      )}
      {!compact && ((p.pros?.length ?? 0) > 0 || (p.cons?.length ?? 0) > 0) && (
        <div style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 11 }}>
          {(p.pros ?? []).length > 0 && <span style={{ color: "var(--text-tertiary)" }}><b style={{ color: "var(--green)" }}>+</b> {(p.pros ?? []).join(" · ")}</span>}
          {(p.cons ?? []).length > 0 && <span style={{ color: "var(--text-tertiary)" }}><b style={{ color: "var(--amber)" }}>−</b> {(p.cons ?? []).join(" · ")}</span>}
        </div>
      )}
    </div>
  );
}

/* the write-your-own slot — a selectable card that opens the InterfaceEditor */
function WriteOwnSlot({ selected, onSelect }: { selected: boolean; onSelect: () => void }) {
  return (
    <div onClick={onSelect} role="button"
      style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: "var(--r-md)", cursor: "pointer",
        border: selected ? "1px solid var(--text-primary)" : "0.5px dashed var(--border-strong)", boxShadow: selected ? "0 0 0 1px var(--text-primary)" : "none",
        background: selected ? "var(--bg-active)" : "transparent" }}>
      <Icon name="plus" size={12} style={{ color: "var(--text-tertiary)" }} />
      <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)" }}>Write your own shape</span>
    </div>
  );
}

/* the CDD authoring tool — method · path · request/response fields · errors, + an "AI draft from a description"
   shortcut. Used by the producer's write-your-own AND the consumer's counter (how two people author an interface). */
function InterfaceEditor({ value, onChange, agreementId }: { value: InterfaceDraft; onChange: (d: InterfaceDraft) => void; agreementId: string }) {
  const [desc, setDesc] = useState("");
  const drafting = useMutation({ mutationFn: () => api.draftShape(agreementId, desc), onSuccess: (d) => onChange(d as InterfaceDraft), onError: () => toast.error("Draft failed") });
  const set = (patch: Partial<InterfaceDraft>) => onChange({ ...value, ...patch });
  const key = (k: "request_fields" | "response_fields") => (value as any)[k] as Field[];
  const setField = (k: "request_fields" | "response_fields", i: number, patch: Partial<Field>) => set({ [k]: key(k).map((f, j) => j === i ? { ...f, ...patch } : f) } as any);
  const addField = (k: "request_fields" | "response_fields") => set({ [k]: [...(key(k) ?? []), { name: "", type: "string", required: true }] } as any);
  const rmField = (k: "request_fields" | "response_fields", i: number) => set({ [k]: key(k).filter((_, j) => j !== i) } as any);
  return (
    <div style={{ marginTop: 9, padding: 11, border: "0.5px solid var(--border)", borderRadius: "var(--r-md)", background: "var(--bg-elevated)", display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Describe it — e.g. 'login returns a JWT + refresh'" style={inputStyle} />
        <Button variant="ghost" size="sm" icon="bolt" disabled={drafting.isPending || !desc.trim()} onClick={() => drafting.mutate()}>AI draft</Button>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <select value={value.method} onChange={(e) => set({ method: e.target.value })} style={{ ...inputStyle, width: 90, flexShrink: 0 }}>{METHODS.map((mm) => <option key={mm} value={mm}>{mm}</option>)}</select>
        <input value={value.path} onChange={(e) => set({ path: e.target.value })} placeholder="/api/..." className="mono" style={inputStyle} />
      </div>
      <FieldEditor label="Request" fields={key("request_fields")} onAdd={() => addField("request_fields")} onSet={(i, p) => setField("request_fields", i, p)} onRemove={(i) => rmField("request_fields", i)} />
      <FieldEditor label="Response" fields={key("response_fields")} onAdd={() => addField("response_fields")} onSet={(i, p) => setField("response_fields", i, p)} onRemove={(i) => rmField("response_fields", i)} />
      <input value={(value.errors ?? []).join(", ")} onChange={(e) => set({ errors: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
        placeholder='Errors — e.g. "401 unauthorized, 429 rate_limited"' className="mono" style={inputStyle} />
    </div>
  );
}

function FieldEditor({ label, fields, onAdd, onSet, onRemove }: { label: string; fields: Field[]; onAdd: () => void; onSet: (i: number, p: Partial<Field>) => void; onRemove: (i: number) => void }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
        <span className="mono" style={{ fontSize: 9.5, color: "var(--text-quaternary)", letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}</span>
        <button onClick={onAdd} style={{ fontSize: 11, color: "var(--text-tertiary)", display: "inline-flex", alignItems: "center", gap: 3 }}><Icon name="plus" size={10} />field</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {(fields ?? []).map((f, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input value={f.name} onChange={(e) => onSet(i, { name: e.target.value })} placeholder="name" className="mono" style={{ ...inputStyle, height: 26, flex: 1 }} />
            <select value={f.type} onChange={(e) => onSet(i, { type: e.target.value })} style={{ ...inputStyle, height: 26, width: 86, flexShrink: 0 }}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, color: "var(--text-tertiary)", flexShrink: 0 }}>
              <input type="checkbox" checked={f.required !== false} onChange={(e) => onSet(i, { required: e.target.checked })} />req
            </label>
            <button onClick={() => onRemove(i)} style={{ color: "var(--text-quaternary)", flexShrink: 0 }}><Icon name="close" size={12} /></button>
          </div>
        ))}
      </div>
    </div>
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
