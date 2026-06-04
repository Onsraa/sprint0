/* sprint0 — "g then key" navigation leader (Linear / GitHub / Gmail convention). Press g outside a text
   field, then a nav key within 1.2s. Modifier-free on purpose, so it never collides with the browser's
   ⌘-shortcuts (⌘W close tab, ⌘L address bar, ⌘D bookmark, …). The hints render as "G D" in the nav. */
import { useEffect, useRef } from "react";

// second-key → view id (matches the NAV ids + the displayed kbd hints in AppShellNew)
const NAV_KEYS: Record<string, string> = {
  i: "inbox",     // Inbox
  l: "relays",
  w: "mywork",
  p: "projects",
  q: "qagate",    // Tester
  t: "team",
};

const isEditable = (el: EventTarget | null): boolean => {
  const n = el as HTMLElement | null;
  return !!n && (n.tagName === "INPUT" || n.tagName === "TEXTAREA" || n.isContentEditable);
};

export function useNavShortcuts(go: (view: string) => void, allowed: (view: string) => boolean) {
  const goRef = useRef(go); goRef.current = go;
  const okRef = useRef(allowed); okRef.current = allowed;
  useEffect(() => {
    let armed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isEditable(e.target)) return;
      const k = e.key.toLowerCase();
      if (!armed) {
        if (k === "g") { armed = true; clearTimeout(timer); timer = setTimeout(() => { armed = false; }, 1200); }
        return;
      }
      armed = false; clearTimeout(timer);
      const view = NAV_KEYS[k];
      if (view && okRef.current(view)) { e.preventDefault(); goRef.current(view); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); clearTimeout(timer); };
  }, []);
}
