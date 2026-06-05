/* sprint0 — the canonical notification metadata (icon · label · colour intent · how it acts), shared by the
   bell so the 11 real backend `type`s render consistently. Colour by intent: green = good/finished ·
   red = urgent (something broke) · orange = act (you decide/resolve) · grey = neutral FYI.
   `act` says how an actionable notification behaves in the bell: "redirect" → a button that deep-links to the
   subject (`to` view + `cta` label); "inline" → buttons that act in place (reschedule consent · grant/deny a
   watch). The other kinds inform only. */
import type { IconName } from "../../lib/icon";

export type NotifIntent = "good" | "urgent" | "act" | "neutral";
export const INTENT_COLOR: Record<NotifIntent, string> = {
  good: "var(--green)", urgent: "var(--red)", act: "var(--amber)", neutral: "var(--text-tertiary)",
};

export type NotifMeta = { icon: IconName; label: string; intent: NotifIntent; act?: "redirect" | "inline"; to?: string; cta?: string };

/* one entry per real Notification.type (orchestrator/app/contracts.py). No display aliases. */
export const NOTIF_META: Record<string, NotifMeta> = {
  // relay · ratify — redirect to the Gate × Contract page (the act surface)
  ratify_needed:       { icon: "ratify",   label: "Ratify",     intent: "act",     act: "redirect", to: "gatecontract", cta: "Ratify your slice" },
  agreement_proposed:  { icon: "relay",    label: "Contract",   intent: "act",     act: "redirect", to: "gatecontract", cta: "Sign the Contract" },
  // tester · acceptance — redirect to Tester
  qa_failed:           { icon: "bolt",     label: "Acceptance", intent: "urgent",  act: "redirect", to: "qagate",       cta: "Open acceptance" },
  project_shipped:     { icon: "check",    label: "Shipped",    intent: "good" },
  // work · tasks
  task_assigned:       { icon: "board",    label: "Assigned",   intent: "neutral" },
  task_completed:      { icon: "check",    label: "Done",       intent: "good" },
  // reflow · reschedule — act inline (apply / reject)
  reschedule_proposed: { icon: "calendar", label: "Reschedule", intent: "act",     act: "inline" },
  reschedule_resolved: { icon: "calendar", label: "Reschedule", intent: "good" },
  // access · watch — act inline (grant / deny)
  access_requested:    { icon: "eye",      label: "Watch",      intent: "act",     act: "inline" },
  access_granted:      { icon: "eye",      label: "Watch",      intent: "good" },
  // governance · drift
  drift_flagged:       { icon: "bolt",     label: "Drift",      intent: "urgent" },
};

export const notifMeta = (kind: string): NotifMeta => NOTIF_META[kind] ?? { icon: "bell" as IconName, label: "Update", intent: "neutral" };
export const notifColor = (kind: string) => INTENT_COLOR[notifMeta(kind).intent];
