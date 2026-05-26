import type { WizardKind } from "../app/types";
import { WizardBrief } from "./WizardBrief";
import { WizardHire } from "./WizardHire";

/** Routes the open wizard to the right flow. Each flow renders its own
 *  full-screen overlay and closes via setWizardOpen(false). */
export function Wizard({ kind }: { kind: WizardKind }) {
  return kind === "brief" ? <WizardBrief /> : <WizardHire />;
}
