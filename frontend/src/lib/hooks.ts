/* sprint0 — tiny shared UI hooks. Keep these dependency-free (react only). */
import { useState } from "react";

/** Hover flag + the handlers to spread onto an element — replaces the repeated
 *  `const [h, setH] = useState(false)` + inline onMouseEnter/Leave across the chrome.
 *  Usage: `const [h, hover] = useHoverState(); <button {...hover} style={{ background: h ? … }}>`. */
export function useHoverState() {
  const [h, setH] = useState(false);
  return [h, { onMouseEnter: () => setH(true), onMouseLeave: () => setH(false) }] as const;
}
