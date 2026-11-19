/* §12 graded references — the earned-strength ladder, shared by Portfolio, RatifyPanel and Passport
   (was duplicated per-view; single source so a wording/step change can't drift). */
export const GRADE_META: Record<string, { label: string; step: number; proven: boolean; hint: string }> = {
  proposed:        { label: "Proposed",        step: 1, proven: false, hint: "not yet proven" },
  shipped:         { label: "Shipped",         step: 2, proven: false, hint: "merged, not battle-tested" },
  prod_survived:   { label: "Prod-survived",   step: 3, proven: true,  hint: "survived in production" },
  retro_validated: { label: "Retro-validated", step: 4, proven: true,  hint: "confirmed in retro" },
};
