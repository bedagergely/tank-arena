import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AdminPanel } from "./AdminPanel.tsx";
import "../styles.css";

createRoot(document.getElementById("admin-root")!).render(
  <StrictMode>
    <AdminPanel />
  </StrictMode>,
);
