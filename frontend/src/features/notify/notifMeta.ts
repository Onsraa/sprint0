/* sprint0 — the canonical notification metadata (icon · label · colour intent), shared by the Inbox and the
   bell so the 11 real backend `type`s render consistently. Colour by intent: green = good/finished ·
   red = urgent (something broke) · orange = act (you decide/resolve) · grey = neutral FYI. */
import type { IconName } from "../../lib/icon";

export type NotifIntent = "good" | "urgent" | "act" | "neutral";
export const INTENT_COLOR: Record<NotifIntent, string> = {
  good: "var(--green)", urgent: "var(--red)", act: "var(--amber)", neutral: "var(--text-tertiary)",
};

/* one entry per real Notification.type (orchestrator/app/contracts.py). No display aliases. */
export const NOTIF_META: Record<string, { icon: IconName; label: string; intent: NotifIntent }> = {
  // relay · ratify
  ratify_needed:       { icon: "ratify",   label: "Ratify",     intent: "act" },     // a gate reached you
  agreement_proposed:  { icon: "relay",    label: "Contract",   intent: "act" },     // sign a Contract
  // tester · acceptance
  qa_failed:           { icon: "bolt",     label: "Acceptance", intent: "urgent" },  // a check / contract failed
  project_shipped:     { icon: "check",    label: "Shipped",    intent: "good" },
  // work · tasks
  task_assigned:       { icon: "board",    label: "Assigned",   intent: "neutral" },
  task_completed:      { icon: "check",    label: "Done",       intent: "good" },
  // reflow · reschedule
  reschedule_proposed: { icon: "calendar", label: "Reschedule", intent: "act" },     // consent
  reschedule_resolved: { icon: "calendar", label: "Reschedule", intent: "good" },
  // access · watch
  access_requested:    { icon: "eye",      label: "Watch",      intent: "act" },     // grant / deny
  access_granted:      { icon: "eye",      label: "Watch",      intent: "good" },
  // governance · drift
  drift_flagged:       { icon: "bolt",     label: "Drift",      intent: "urgent" },
};

export const notifMeta = (kind: string) => NOTIF_META[kind] ?? { icon: "bell" as IconName, label: "Update", intent: "neutral" as NotifIntent };
export const notifColor = (kind: string) => INTENT_COLOR[notifMeta(kind).intent];
