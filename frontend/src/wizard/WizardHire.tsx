import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useUI } from "../lib/store";
import { Icon, ZeroMark } from "../lib/icon";
import { Button, IconButton, Badge, DISC } from "../components/ui";
import { api } from "../lib/api";
import type { Member } from "../lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "../lib/query";

/* sprint0 — Hire wizard, wired to the real gateway: drop/paste a CV → POST /api/developers
   (Gemini parses it, links the GitLab user, seeds a low-trust passport in Mongo) → the new
   member joins the roster (login + assignment pool). The junior added live in the demo.
   Form state is React Hook Form + a Zod resolver (file XOR a ≥20-char paste).
   sprint0 × Linear: floating white pane, hairline borders, the brand zero (mascot retired). */

const DEMO_JUNIOR_CV = `Jamie Lee — Junior Developer
1 year of experience, bootcamp graduate (2025).
Skills: HTML, CSS, JavaScript, basic React, Figma basics.
Built: a personal portfolio site, a to-do app, and a landing page on a team bootcamp project.
Keen to grow into UI/UX and frontend work. No production backend or DevOps experience yet.`;

const HireForm = z
  .object({ text: z.string(), file: z.instanceof(File).nullable() })
  .refine((v) => !!v.file || v.text.trim().length > 20, { message: "Paste a CV (20+ chars) or choose a file", path: ["text"] });
type HireForm = z.infer<typeof HireForm>;

export function WizardHire() {
  const setWizardOpen = useUI((s) => s.setWizardOpen);
  const qc = useQueryClient();
  const [result, setResult] = useState<Member | null>(null);
  const { register, handleSubmit, watch, setValue, formState } = useForm<HireForm>({
    resolver: zodResolver(HireForm),
    mode: "onChange",
    defaultValues: { text: "", file: null },
  });
  const file = watch("file");
  const { isSubmitting, isValid } = formState;

  const close = () => setWizardOpen(false);

  // Single submit: Zod gate already passed, so just POST and show the result (errors → toast).
  const onboard = handleSubmit(async (v) => {
    try {
      setResult(await api.addDeveloper(v.file ? { file: v.file } : { text: v.text }));
      qc.invalidateQueries({ queryKey: qk.roster() });  // new dev shows immediately (was 30s stale)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Onboarding failed");
    }
  });

  return (
    <div
      onClick={close}
      style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "rgba(26,23,20,0.10)", animation: "s0-fade-in var(--t-quick) both" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 600, maxHeight: "calc(100vh - 48px)", background: "var(--bg-elevated)", borderRadius: "var(--r-lg)", border: "0.5px solid var(--border-strong)", boxShadow: "var(--shadow-3)", display: "flex", flexDirection: "column", overflow: "hidden", animation: "s0-pop-in var(--t-reg) var(--ease-out) both" }}
      >
        <div style={{ height: "var(--topbar-h)", flexShrink: 0, display: "flex", alignItems: "center", gap: 10, padding: "0 10px 0 16px", borderBottom: "0.5px solid var(--border-subtle)" }}>
          <ZeroMark size={16} />
          <div style={{ lineHeight: 1.2 }}>
            <div className="kicker">Onboard a developer</div>
            <div style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: "-0.2px" }}>Cold-start passport</div>
          </div>
          <div style={{ flex: 1 }} />
          <IconButton name="close" title="Close" onClick={close} />
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
          {result ? (
            <ResultCard member={result} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.4px", margin: "0 0 5px" }}>Drop their CV</h1>
                <p style={{ fontSize: 13.5, color: "var(--text-tertiary)", margin: 0, lineHeight: 1.55 }}>sprint0 reads it, links the GitLab account, and seeds a low-trust passport in MongoDB.</p>
              </div>
              <label
                style={{ padding: 20, border: `0.5px dashed ${file ? "var(--green)" : "var(--border-strong)"}`, borderRadius: "var(--r-md)", textAlign: "center", cursor: "pointer", background: "var(--bg-secondary)", transition: "border-color var(--t-quick)" }}
              >
                <input type="file" accept=".pdf,.txt,.md" style={{ display: "none" }}
                  onChange={(e) => { setValue("file", e.target.files?.[0] ?? null, { shouldValidate: true }); setValue("text", "", { shouldValidate: true }); }} />
                <div style={{ color: file ? "var(--green)" : "var(--text-tertiary)", display: "grid", placeItems: "center" }}><Icon name={file ? "doc" : "upload"} size={22} /></div>
                <div style={{ fontSize: 13, fontWeight: 500, marginTop: 7, color: file ? "var(--text-primary)" : "var(--text-secondary)" }}>{file ? file.name : "Choose a CV file (PDF / text)"}</div>
              </label>
              <div style={{ textAlign: "center", fontSize: 11.5, color: "var(--text-quaternary)" }}>or paste the CV</div>
              <textarea
                {...register("text", { onChange: () => { if (watch("file")) setValue("file", null); } })}
                placeholder="Paste CV text…"
                rows={6}
                style={{ width: "100%", padding: 12, borderRadius: "var(--r-md)", border: "0.5px solid var(--border-strong)", background: "var(--bg-elevated)", fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-primary)", resize: "vertical", outline: "none" }}
              />
              <Button variant="ghost" size="sm" style={{ alignSelf: "flex-start" }}
                onClick={() => { setValue("text", DEMO_JUNIOR_CV, { shouldValidate: true }); setValue("file", null, { shouldValidate: true }); }}>
                Use the demo junior CV
              </Button>
            </div>
          )}
        </div>

        <div style={{ flexShrink: 0, padding: "12px 16px", borderTop: "0.5px solid var(--border-subtle)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          {result ? (
            <Button variant="primary" size="md" iconRight="arrowRight" onClick={close}>Done</Button>
          ) : (
            <Button variant="primary" size="md" iconRight="arrowRight" onClick={onboard} disabled={isSubmitting || !isValid}>
              {isSubmitting ? "Onboarding…" : "Onboard"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultCard({ member }: { member: Member & { suggested_discipline?: string | null } }) {
  const qc = useQueryClient();
  const linked = member.gitlab_user_id != null;
  const [seated, setSeated] = useState<string | null>(member.discipline ?? null);
  const [linkBusy, setLinkBusy] = useState(false);
  const suggestion = member.suggested_discipline;
  const tryLink = async () => {
    setLinkBusy(true);
    try {
      const r = (await api.linkMember(member.username || member.gitlab_username)) as { linked?: boolean; conflict?: string };
      if (r?.linked) { toast.success(`Linked ${member.name.split(" ")[0]} → GitLab`); qc.invalidateQueries({ queryKey: qk.roster() }); }
      else if (r?.conflict) toast.error(r.conflict);
      else toast.error(`No GitLab account found for @${member.gitlab_username}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Link failed"); }
    finally { setLinkBusy(false); }
  };
  const seat = async (d: string) => {
    try {
      await api.setDiscipline(member.gitlab_username, d);
      setSeated(d);
      toast.success(`${member.name} seated in ${DISC[d as keyof typeof DISC]?.label ?? d}`);
      qc.invalidateQueries({ queryKey: qk.roster() });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not seat");
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon name="check" size={18} style={{ color: "var(--green)" }} />
        <h1 style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-0.3px", margin: 0 }}>{member.name} joined the team</h1>
      </div>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 11, background: "var(--bg-elevated)", border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-1)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1 }}><Row k="GitLab" v={linked ? `@${member.gitlab_username} · native assignee` : `@${member.gitlab_username} · no matching GitLab account yet`} ok={linked} /></div>
          {!linked && <button onClick={tryLink} disabled={linkBusy}
            style={{ height: 24, padding: "0 9px", fontSize: 11.5, fontWeight: 600, borderRadius: "var(--r-md)", border: "0.5px solid var(--border-strong)", background: "var(--bg-secondary)", color: "var(--text-primary)", cursor: linkBusy ? "default" : "pointer" }}>Link now</button>}
        </div>
        <Row k="Role" v={`${member.seniority ?? "junior"} ${seated ?? "developer"}`} />
        <Row k="Trust" v={`${member.trust_level} (cold-start) — grows per-discipline with every merge`} />
        <Row k="Skills" v={member.skills_text} />
      </div>
      {suggestion && !seated && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "var(--bg-secondary)", border: "0.5px solid var(--border)", borderRadius: "var(--r-md)" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Seat them in a discipline</div>
            <div style={{ fontSize: 12.5, color: "var(--text-tertiary)", marginTop: 2, lineHeight: 1.5 }}>sprint0 reads <strong>{DISC[suggestion as keyof typeof DISC]?.label ?? suggestion}</strong> from the CV. Confirm to put them in-lane — until then the AI won't assign them work.</div>
          </div>
          <Button variant="primary" size="sm" onClick={() => seat(suggestion)}>Seat in {DISC[suggestion as keyof typeof DISC]?.label ?? suggestion}</Button>
        </div>
      )}
      {seated ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 12, background: "var(--bg-secondary)", borderRadius: "var(--r-md)", fontSize: 12.5, color: "var(--text-secondary)" }}>
          <Icon name="check" size={15} style={{ color: "var(--green)" }} />Seated in {DISC[seated as keyof typeof DISC]?.label ?? seated} — now an in-lane candidate for the next plan.
        </div>
      ) : (
        <div style={{ padding: 12, background: "var(--bg-secondary)", borderRadius: "var(--r-md)", fontSize: 12.5, color: "var(--text-tertiary)", lineHeight: 1.55 }}>
          In MongoDB now and in the assignment pool — eligible for the next plan (low-risk first; out-of-discipline work is flagged as a stretch).
        </div>
      )}
    </div>
  );
}

function Row({ k, v, ok }: { k: string; v: string; ok?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 12, fontSize: 13, alignItems: "baseline" }}>
      <span className="kicker" style={{ minWidth: 56, flexShrink: 0 }}>{k}</span>
      <span style={{ flex: 1, color: "var(--text-secondary)", display: "inline-flex", alignItems: "center", gap: 7 }}>
        {v}{ok && <Badge tone="green">linked</Badge>}
      </span>
    </div>
  );
}
