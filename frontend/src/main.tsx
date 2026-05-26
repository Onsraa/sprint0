import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/shared.css";
import "./styles/app.css";
import { AppProvider } from "./app/AppContext";
import { AppShell } from "./app/AppShell";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider>
      <AppShell />
    </AppProvider>
  </StrictMode>,
);
