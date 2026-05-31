import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { Toaster } from "sonner";
import "./styles/shared.css";
import "./styles/app.css";
import { queryClient } from "./lib/query";
import { router } from "./app/router";

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
