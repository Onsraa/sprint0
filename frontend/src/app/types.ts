/* Persona the user is acting as. Manager runs intake/relay; the four leads
   ratify + work their own discipline; QA runs the acceptance gate. */
export type Role = "manager" | "uiux" | "backend" | "frontend" | "qa";

/* Legacy mode kept for the dev-surface views (Active issue / Passport),
   which a lead drops into. Derived from Role. */
export type Mode = "manager" | "dev";

export type ManagerView = "dashboard" | "work" | "team" | "relay" | "relays" | "gatecontract" | "queue" | "ratify" | "portfolio" | "attributions" | "codegraph" | "profiles" | "settings";
export type DevView = "work" | "relays" | "relay" | "gatecontract" | "issue" | "passport" | "ratify" | "qa" | "queue" | "portfolio" | "team" | "dashboard";
export type View = ManagerView | DevView;
export type WizardKind = "brief" | "hire";
