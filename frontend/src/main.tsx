import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { Toaster } from "sonner";
import "./styles/tokens.css";
import "./styles/shared.css";
import "./styles/app.css";
import { queryClient } from "./lib/query";
import { router } from "./app/router";
import { live } from "./lib/api";

// Magic link: `?unlock=<TOKEN>` flips this tab to LIVE mode (real Vertex + GitLab), then strips
// the token from the address bar so it isn't shoulder-surfed or accidentally re-shared. The public
// root (no param) stays in DEMO mode.
const unlock = new URLSearchParams(window.location.search).get("unlock");
if (unlock) {
  live.set(unlock);
  const url = new URL(window.location.href);
  url.searchParams.delete("unlock");
  window.history.replaceState({}, "", url.toString());
}

// Query outermost (router loaders can use it), then the Router (its root renders
// <AppProvider><AppShellNew/></>), then Sonner's toast host. P3 swaps the CSS imports to tokens.css.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster position="bottom-right" />
    </QueryClientProvider>
  </StrictMode>,
);
