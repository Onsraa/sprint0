/* sprint0 — ⌘K command palette. cmdk for list/filter/keyboard; Radix Dialog for the accessible
 * modal shell (focus trap, scroll lock, Esc). Open state in Zustand (useUI) so a button, the hotkey,
 * or a deep link can all open it. Commands are role-gated. Styled via .cmd__* in app.css. */
import { useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { useNavigate } from "@tanstack/react-router";
import { useUI } from "../../lib/store";
import { useMe } from "../../features/auth/useAuth";
import { Icon, type IconName } from "../../lib/icon";

type Cmd = { id: string; label: string; icon: IconName; run: () => void };

export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen);
  const togglePalette = useUI((s) => s.togglePalette);
  const closePalette = useUI((s) => s.closePalette);
  const navigate = useNavigate();
  const { role } = useMe();
  const setWizardOpen = useUI((s) => s.setWizardOpen);
  const setWizardKind = useUI((s) => s.setWizardKind);
  const setFeatureProjectId = useUI((s) => s.setFeatureProjectId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); togglePalette(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [togglePalette]);

  const go = (to: string): (() => void) => () => navigate({ to: to as "/" }); // cast: routes registered at runtime
  const isManager = role === "manager";

  const baseNav: Cmd[] = [
    { id: "relays", label: "Go to Relays", icon: "pool", run: go("/relays") },
    { id: "gatecontract", label: "Open a Gate × Contract", icon: "ratify", run: go("/gatecontract") },
    { id: "work", label: "Go to My Work", icon: "board", run: go("/work") },
    { id: "projects", label: "Go to Projects", icon: "projects", run: go("/dashboard") },
    { id: "team", label: "Go to Team", icon: "team", run: go("/team") },
    { id: "portfolio", label: "Go to Decisions", icon: "portfolio", run: go("/portfolio") },
  ];
  const navigateCmds: Cmd[] = role === "qa"
    ? [...baseNav, { id: "qagate", label: "Go to Tester", icon: "qa", run: go("/qa") }]
    : baseNav;

  const createCmds: Cmd[] = isManager
    ? [
        { id: "new-brief", label: "New project from brief", icon: "plus", run: () => { setFeatureProjectId(null); setWizardKind("brief"); setWizardOpen(true); } },
        { id: "hire", label: "Onboard a developer", icon: "team", run: () => { setWizardKind("hire"); setWizardOpen(true); } },
      ]
    : [];

  const runCmd = (c: Cmd) => { c.run(); closePalette(); };

  return (
    <Dialog.Root open={open} onOpenChange={(v) => (v ? null : closePalette())}>
      <Dialog.Portal>
        <Dialog.Overlay className="cmd__overlay" />
        <Dialog.Content className="cmd__content" aria-label="Command palette">
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Command label="Command palette">
            <div className="cmd__search">
              <Icon name="search" size={16} />
              <Command.Input placeholder="Jump to or run a command…" autoFocus />
            </div>
            <Command.List className="cmd__list">
              <Command.Empty className="cmd__empty">No results.</Command.Empty>
              <Command.Group heading="Navigate">
                {navigateCmds.map((c) => <Item key={c.id} c={c} onRun={runCmd} />)}
              </Command.Group>
              {createCmds.length > 0 && (
                <Command.Group heading="Create">
                  {createCmds.map((c) => <Item key={c.id} c={c} onRun={runCmd} />)}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Item({ c, onRun }: { c: Cmd; onRun: (c: Cmd) => void }) {
  return (
    <Command.Item value={c.label} onSelect={() => onRun(c)} className="cmd__item">
      <Icon name={c.icon} size={16} />
      <span>{c.label}</span>
    </Command.Item>
  );
}
