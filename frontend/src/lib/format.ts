// Small formatting helpers (presentation only — no design rules).

// Human-readable short date from an ISO string: "2026-06-02T01:56:40Z" → "Jun 2, 2026".
// Empty → ""; unparseable → the input unchanged.
export function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
