/* Polymorphic execution surface — renders by the WORK's `kind`, not the viewer's role.
   A code/infra task shows the file-focus + branch command; design shows figma + frames;
   audit shows the rubric; content/runbook fall through to a plain brief. Shared by the dev
   active-issue view, the ratify panel, and the task drawer so the same slice renders the
   same way wherever it's opened. Tolerates both the full Issue and the thinner Task shape. */
import { useApp } from "../app/AppContext";
import type { ContextScope, Kind } from "../lib/api";
import { KIND_LABEL } from "../lib/relayUtils";

export interface KindWork {
  id: string;
  kind?: Kind | null;
  description?: string;
  api_contract?: string | null;
  context?: Record<string, unknown>;
  context_scope?: ContextScope;
}

const EMPTY_SCOPE: ContextScope = { files: [], note: "" };

export function KindSurface({ work }: { work: KindWork }) {
  const kind = work.kind ?? null;
  if (kind === "code" || kind === "infra") return <CodeSurface work={work} />;
  if (kind === "design") return <DesignSurface work={work} />;
  if (kind === "audit") return <AuditSurface work={work} />;
  return <GenericSurface work={work} />; // content / runbook / unknown → plain brief
}

function CodeSurface({ work }: { work: KindWork }) {
  const { liveCloneUrl } = useApp();
  const scope = work.context_scope ?? EMPTY_SCOPE;
  const files = scope.files ?? [];
  const bid = work.id.toLowerCase();
  const dir = liveCloneUrl ? (liveCloneUrl.replace(/\/+$/, "").split("/").pop() || "repo").replace(/\.git$/, "") : "<project>";
  const cmd = liveCloneUrl
    ? `git clone ${liveCloneUrl} && cd ${dir} && git checkout sprint0/${bid} && bash .sprint0/focus.sh && code .`
    : `git checkout sprint0/${bid} && bash .sprint0/focus.sh && code .`;
  const apiContract = typeof work.api_contract === "string" ? work.api_contract : null;
  return (
    <>
      <div className="card-soft" style={{ padding: 18, marginBottom: 12 }}>
        <div className="kicker" style={{ marginBottom: 10 }}>
          Context scope · {files.length} {files.length === 1 ? "file" : "files"}
        </div>
        {scope.note && (
          <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 10 }}>{scope.note}</div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {files.length === 0 && <div style={{ fontSize: 13, color: "var(--ink-mute)" }}>No files scoped yet.</div>}
          {files.map((f) => (
            <div
              key={f}
              className="mono"
              style={{ fontSize: 12, padding: "6px 10px", background: "var(--cream)", borderRadius: 6, border: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 8 }}
            >
              <span style={{ color: "var(--orange)" }}>●</span>
              {f}
            </div>
          ))}
        </div>
      </div>

      <div
        className="mono"
        style={{ background: "var(--ink)", color: "var(--paper)", borderRadius: 12, padding: 16, fontSize: 13, marginBottom: 12, boxShadow: "4px 4px 0 var(--orange)" }}
      >
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", marginBottom: 8 }}>fetch → focus → open (VSCode; swap `code .` for your editor)</div>
        <div style={{ color: "var(--orange)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>$ {cmd}</div>
      </div>

      {apiContract && (
        <div className="card-soft" style={{ padding: 18 }}>
          <div className="kicker" style={{ marginBottom: 8 }}>API contract</div>
          <pre className="mono" style={{ margin: 0, fontSize: 12, color: "var(--ink-soft)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {apiContract}
          </pre>
        </div>
      )}
    </>
  );
}

function DesignSurface({ work }: { work: KindWork }) {
  const scope = work.context_scope ?? EMPTY_SCOPE;
  const figma = typeof work.context?.figma_file === "string" ? (work.context.figma_file as string) : null;
  return (
    <>
      <div className="card-soft" style={{ padding: 18, marginBottom: 12 }}>
        <div className="kicker" style={{ marginBottom: 8 }}>Design brief</div>
        <div style={{ fontSize: 14, color: "var(--ink-soft)", lineHeight: 1.5 }}>
          {scope.note || work.description}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="card-soft" style={{ padding: 18 }}>
          <div className="kicker" style={{ marginBottom: 8 }}>Figma</div>
          {figma ? (
            <a href={figma} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 13, color: "var(--info)", textDecoration: "underline", textUnderlineOffset: 3, wordBreak: "break-all" }}>
              {figma}
            </a>
          ) : (
            <div style={{ fontSize: 13, color: "var(--ink-mute)" }}>No Figma file linked yet.</div>
          )}
        </div>
        <div className="card-soft" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="kicker">Deliverable</div>
          <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Attach the frames you ship for this issue.</div>
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }}>+ Attach frames</button>
        </div>
      </div>
    </>
  );
}

function AuditSurface({ work }: { work: KindWork }) {
  const scope = work.context_scope ?? EMPTY_SCOPE;
  const pages = Array.isArray(work.context?.target_pages) ? (work.context!.target_pages as string[]) : (scope.files ?? []);
  const rubric = Array.isArray(work.context?.rubric)
    ? (work.context!.rubric as string[])
    : typeof work.context?.rubric === "string"
      ? [work.context!.rubric as string]
      : [];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <div className="card-soft" style={{ padding: 18 }}>
        <div className="kicker" style={{ marginBottom: 10 }}>Target pages</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {pages.length === 0 && <div style={{ fontSize: 13, color: "var(--ink-mute)" }}>No pages specified.</div>}
          {pages.map((p) => (
            <div key={p} className="mono" style={{ fontSize: 12, padding: "6px 10px", background: "var(--cream)", borderRadius: 6, border: "1px solid var(--line)" }}>
              {p}
            </div>
          ))}
        </div>
      </div>
      <div className="card-soft" style={{ padding: 18 }}>
        <div className="kicker" style={{ marginBottom: 10 }}>Rubric</div>
        {rubric.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--ink-mute)" }}>{scope.note || "Use the standard accessibility + UX rubric."}</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.6 }}>
            {rubric.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function GenericSurface({ work }: { work: KindWork }) {
  const scope = work.context_scope ?? EMPTY_SCOPE;
  const files = scope.files ?? [];
  return (
    <div className="card-soft" style={{ padding: 18 }}>
      <div className="kicker" style={{ marginBottom: 8 }}>{work.kind ? KIND_LABEL[work.kind] : "Work"} brief</div>
      <div style={{ fontSize: 14, color: "var(--ink-soft)", lineHeight: 1.5 }}>
        {scope.note || work.description}
      </div>
      {files.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 12 }}>
          {files.map((f) => (
            <div key={f} className="mono" style={{ fontSize: 12, padding: "6px 10px", background: "var(--cream)", borderRadius: 6, border: "1px solid var(--line)" }}>
              {f}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
